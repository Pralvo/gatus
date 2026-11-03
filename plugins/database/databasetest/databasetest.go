// Package databasetest runs a test against each database this machine offers.
// SQLite always runs. Postgres runs when TEST_POSTGRES_DSN is set, and each run
// gets its own schema, so test packages can share one server in parallel.
package databasetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database"
)

// EnvPostgres holds the connection string of a server tests may use.
const EnvPostgres = "TEST_POSTGRES_DSN"

// Each runs test once per database, as a subtest named after the dialect.
func Each(t *testing.T, test func(t *testing.T, db *database.DB)) {
	t.Helper()
	t.Run(string(database.SQLite), func(t *testing.T) { test(t, SQLite(t)) })
	t.Run(string(database.Postgres), func(t *testing.T) { test(t, Postgres(t)) })
}

// SQLite returns a new database in a file that the test removes.
func SQLite(t *testing.T) *database.DB {
	t.Helper()
	return open(t, database.Config{Type: string(database.SQLite), Path: filepath.Join(t.TempDir(), "test.db")})
}

// Postgres returns a connection whose tables live in a new schema that the test
// removes. It skips the test, by name, when no server is configured.
func Postgres(t *testing.T) *database.DB {
	t.Helper()
	return open(t, database.Config{Type: string(database.Postgres), Path: PostgresDSN(t)})
}

// PostgresDSN creates a schema that the test removes and returns a connection
// string that uses it, for a test that configures the plugin itself. It skips the
// test, by name, when no server is configured.
func PostgresDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv(EnvPostgres)
	if dsn == "" {
		t.Skipf("%s is not set, so this did not run against Postgres", EnvPostgres)
	}
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	schema := "test_" + hex.EncodeToString(raw)
	admin := open(t, database.Config{Type: string(database.Postgres), Path: dsn})
	if _, err := admin.SQL().Exec("CREATE SCHEMA " + schema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.SQL().Exec("DROP SCHEMA " + schema + " CASCADE"); err != nil {
			t.Errorf("drop schema: %v", err)
		}
	})
	return withSearchPath(t, dsn, schema)
}

func withSearchPath(t *testing.T, dsn, schema string) string {
	t.Helper()
	if !strings.Contains(dsn, "://") {
		return dsn + " search_path=" + schema
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("%s is not a valid URL", EnvPostgres)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func open(t *testing.T, cfg database.Config) *database.DB {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := database.Open(ctx, cfg)
	if err != nil {
		t.Fatalf("open %s: %v", cfg.Type, err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
