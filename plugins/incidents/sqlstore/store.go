// Package sqlstore saves incidents and reports. The one implementation works on
// SQLite and Postgres: every query passes through the database's Rebind, and the
// only other difference is the row lock taken before an update.
package sqlstore

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

// Store implements record.Store.
type Store struct {
	db *database.DB
}

var _ record.Store = (*Store)(nil)

// New returns a Store. Call Migrate before using it.
func New(db *database.DB) *Store { return &Store{db: db} }

// Migrate brings the tables up to date.
func (s *Store) Migrate() error { return s.db.Migrate(migrationOwner, migrations) }

type runner interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// session is a connection or a transaction. All SQL goes through it, so no query
// can miss Rebind, which would pass on SQLite and fail only on Postgres.
type session struct {
	run  runner
	bind func(string) string
}

func (s session) exec(ctx context.Context, query string, args ...any) error {
	_, err := s.run.ExecContext(ctx, s.bind(query), args...)
	return err
}

func (s session) query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return s.run.QueryContext(ctx, s.bind(query), args...)
}

func (s session) row(ctx context.Context, query string, args ...any) *sql.Row {
	return s.run.QueryRowContext(ctx, s.bind(query), args...)
}

func (s *Store) pool() session { return session{run: s.db.SQL(), bind: s.db.Rebind} }

// inTx runs work in a transaction, which commits only if work returns nil.
func (s *Store) inTx(ctx context.Context, work func(session) error) error {
	tx, err := s.db.SQL().BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("incidents store: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := work(session{run: tx, bind: s.db.Rebind}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("incidents store: commit: %w", err)
	}
	return nil
}

// lockClause makes a read inside a transaction hold the row. SQLite already holds
// its write lock, taken at BEGIN.
func (s *Store) lockClause() string {
	if s.db.Dialect() == database.Postgres {
		return " FOR UPDATE"
	}
	return ""
}

func millis(t time.Time) int64 { return t.UnixMilli() }

func fromMillis(ms int64) time.Time { return time.UnixMilli(ms).UTC() }

func optionalMillis(t *time.Time) sql.NullInt64 {
	if t == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: millis(*t), Valid: true}
}

func optionalTime(ms sql.NullInt64) *time.Time {
	if !ms.Valid {
		return nil
	}
	t := fromMillis(ms.Int64)
	return &t
}

// placeholders returns "?, ?, ?" and the values as arguments.
func placeholders(values []string) (string, []any) {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return strings.TrimSuffix(strings.Repeat("?, ", len(values)), ", "), args
}
