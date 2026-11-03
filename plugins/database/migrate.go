package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// migrateTimeout bounds Migrate, which runs inside a plugin's Start. A hung
// database must never hold up the status page for long.
const migrateTimeout = time.Minute

// migrationLock is the Postgres advisory lock that keeps two overlapping
// instances, such as during a deploy, from migrating at once. SQLite takes the
// same protection from its write lock.
const migrationLock = 0x67617475 // "gatu"

const versionsTable = `CREATE TABLE IF NOT EXISTS plugin_schema_versions (
	owner      TEXT   NOT NULL,
	version    BIGINT NOT NULL,
	applied_at BIGINT NOT NULL,
	PRIMARY KEY (owner, version)
)`

// Migrate brings owner's tables up to date. A migration's version is its
// position in the list, starting at 1, so a list may only grow at the end. Each
// one that has not run yet runs in its own transaction, together with the record
// that it ran, and the first failure stops the rest. Unlike Rebind, migrations
// reach the driver unchanged, so they may hold several statements. Where the
// dialects differ, branch on Dialect.
func (d *DB) Migrate(owner string, migrations []string) error {
	if strings.TrimSpace(owner) == "" {
		return errors.New("database: Migrate needs an owner")
	}
	ctx, cancel := context.WithTimeout(context.Background(), migrateTimeout)
	defer cancel()
	err := d.inLockedTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, versionsTable)
		return err
	})
	if err != nil {
		return fmt.Errorf("database: create version table: %w", err)
	}
	var newest int
	row := d.sql.QueryRowContext(ctx, d.Rebind(`SELECT COALESCE(MAX(version), 0) FROM plugin_schema_versions WHERE owner = ?`), owner)
	if err := row.Scan(&newest); err != nil {
		return fmt.Errorf("database: read versions of %s: %w", owner, err)
	}
	if newest > len(migrations) {
		return fmt.Errorf("database: %s is at version %d but this build only knows %d", owner, newest, len(migrations))
	}
	for i, migration := range migrations {
		if err := d.apply(ctx, owner, i+1, migration); err != nil {
			return fmt.Errorf("database: migrate %s to version %d: %w", owner, i+1, err)
		}
	}
	return nil
}

func (d *DB) apply(ctx context.Context, owner string, version int, migration string) error {
	if strings.TrimSpace(migration) == "" {
		return errors.New("the migration is empty")
	}
	return d.inLockedTx(ctx, func(tx *sql.Tx) error {
		var applied int
		row := tx.QueryRowContext(ctx, d.Rebind(`SELECT COUNT(*) FROM plugin_schema_versions WHERE owner = ? AND version = ?`), owner, version)
		if err := row.Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			return nil
		}
		if _, err := tx.ExecContext(ctx, migration); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, d.Rebind(`INSERT INTO plugin_schema_versions (owner, version, applied_at) VALUES (?, ?, ?)`), owner, version, time.Now().UnixMilli())
		return err
	})
}

func (d *DB) inLockedTx(ctx context.Context, work func(tx *sql.Tx) error) error {
	tx, err := d.sql.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if d.dialect == Postgres {
		if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(migrationLock)); err != nil {
			return err
		}
	}
	if err := work(tx); err != nil {
		return err
	}
	return tx.Commit()
}
