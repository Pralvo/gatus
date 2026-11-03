package database_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
)

// consumer needs the database and hands it to the test.
func consumer(got **database.DB) plugin.Definition {
	return plugin.Definition{
		Name:  "consumer",
		Needs: []plugin.Key{database.Key},
		Start: func(ctx *plugin.Context) error {
			*got = plugin.Get[*database.DB](ctx, database.Key)
			return nil
		},
	}
}

func status(t *testing.T, h *plugintest.Harness, name string) plugin.Status {
	t.Helper()
	for _, s := range h.Host.Statuses() {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("no status for %s", name)
	return plugin.Status{}
}

func TestProvidesAWorkingConnectionAndClosesItOnStop(t *testing.T) {
	var db *database.DB
	config := fmt.Sprintf("type: sqlite\npath: %s\n", filepath.Join(t.TempDir(), "plugins.db"))
	h := plugintest.Start(t, database.Definition, config, nil, consumer(&db))
	if db == nil || db.Dialect() != database.SQLite {
		t.Fatalf("service: %+v", db)
	}
	if _, err := db.SQL().Exec(`CREATE TABLE kept (id INTEGER)`); err != nil {
		t.Fatal(err)
	}
	h.Host.Shutdown()
	if err := db.SQL().Ping(); err == nil {
		t.Fatal("the connection survived the plugin")
	}
}

func TestRefusesConfigThatCanNeverWork(t *testing.T) {
	cases := []struct{ name, config, reason string }{
		{"no path", "type: sqlite", "path is required"},
		{"memory", "type: sqlite\npath: \":memory:\"", "in-memory"},
		{"memory any case", "type: sqlite\npath: \":MEMORY:\"", "in-memory"},
		{"memory uri", "type: sqlite\npath: \"file::memory:?cache=shared\"", "in-memory"},
		{"memory mode", "type: sqlite\npath: \"file:data.db?mode=memory\"", "in-memory"},
		{"memory mode encoded", "type: sqlite\npath: \"file:data.db?mode=%6demory\"", "in-memory"},
		{"memdb", "type: sqlite\npath: \"file:/data.db?vfs=memdb\"", "in-memory"},
		{"temporary", "type: sqlite\npath: \"file:?cache=shared\"", "in-memory"},
		{"unknown type", "type: mysql\npath: x", "must be sqlite or postgres"},
		{"unknown field", "type: sqlite\npath: x\nhost: y", "host"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := plugintest.Load(t, database.Definition, c.config, nil)
			got := status(t, h, "database")
			if got.State != plugin.StateFailed || !strings.Contains(got.Reason, c.reason) {
				t.Fatalf("status: %+v", got)
			}
		})
	}
}

func TestDownDatabaseLeavesDependantsWaitingAndRecovers(t *testing.T) {
	database.SetRetryDelayForTest(t, 20*time.Millisecond)
	directory := filepath.Join(t.TempDir(), "not-mounted-yet")
	config := fmt.Sprintf("type: sqlite\npath: %s\n", filepath.Join(directory, "plugins.db"))
	var db *database.DB
	h := plugintest.Load(t, database.Definition, config, nil, consumer(&db))
	if got := status(t, h, "database"); got.State != plugin.StateFailed {
		t.Fatalf("database: %+v", got)
	}
	if got := status(t, h, "consumer"); got.State != plugin.StateWaiting || !strings.Contains(got.Reason, "provided by database") {
		t.Fatalf("consumer: %+v", got)
	}
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for status(t, h, "consumer").State != plugin.StateActive {
		if time.Now().After(deadline) {
			t.Fatalf("never recovered: %+v", h.Host.Statuses())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestSecretsNeverReachTheStatus(t *testing.T) {
	database.SetRetryDelayForTest(t, time.Hour)
	cases := []struct{ name, path, reason string }{
		{"refused", "postgres://user:s3cret@127.0.0.1:1/db?sslmode=disable&connect_timeout=1", "127.0.0.1"},
		{"keyword form", "host=127.0.0.1 port=1 user=user password=s3cret sslmode=disable connect_timeout=1", "127.0.0.1"},
		{"unparseable", "postgres://user:s3cret/more@host:notaport/db", "not a valid Postgres connection string"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := plugintest.Load(t, database.Definition, "type: postgres\npath: \""+c.path+"\"", nil)
			got := status(t, h, "database")
			if got.State != plugin.StateFailed || !strings.Contains(got.Reason, c.reason) {
				t.Fatalf("status: %+v", got)
			}
			if strings.Contains(got.Reason, "s3cret") {
				t.Fatalf("the password reached the status: %s", got.Reason)
			}
		})
	}
}

func TestRedactRemovesWhatADriverEchoes(t *testing.T) {
	config := database.Config{Type: "postgres", Path: "postgres://user:s3cret@host/db"}
	for _, message := range []string{"cannot reach " + config.Path, "auth failed with s3cret", "bad password=s3cret here", "bad password = 's3 cret' here"} {
		got := database.RedactForTest(config, errors.New(message)).Error()
		if strings.Contains(got, "s3cret") || strings.Contains(got, "cret'") {
			t.Fatalf("%q became %q", message, got)
		}
	}
}

func TestRebind(t *testing.T) {
	postgres := database.NewForTest(database.Postgres)
	cases := []struct{ in, out string }{
		{"SELECT ? , ?", "SELECT $1 , $2"},
		{"UPDATE t SET a = '?', b = ? WHERE c = ?", "UPDATE t SET a = '?', b = $1 WHERE c = $2"},
		{`SELECT "odd?name", ?`, `SELECT "odd?name", $1`},
		{"SELECT 'it''s?', ?", "SELECT 'it''s?', $1"},
		{"SELECT 1 -- why?\n, ?", "SELECT 1 -- why?\n, $1"},
		{"SELECT /* why? */ ?", "SELECT /* why? */ $1"},
		{"SELECT 'never closed ?", "SELECT 'never closed ?"},
	}
	for _, c := range cases {
		if got := postgres.Rebind(c.in); got != c.out {
			t.Errorf("Rebind(%q) = %q, want %q", c.in, got, c.out)
		}
	}
	if got := database.NewForTest(database.SQLite).Rebind("SELECT ?"); got != "SELECT ?" {
		t.Errorf("sqlite query changed: %q", got)
	}
}

func count(t *testing.T, db *database.DB, table string) int {
	t.Helper()
	var n int
	if err := db.SQL().QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func TestMigrateRunsEachVersionOncePerOwner(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		first := []string{`CREATE TABLE a (id INTEGER); INSERT INTO a VALUES (1)`}
		if err := db.Migrate("one", first); err != nil {
			t.Fatal(err)
		}
		if err := db.Migrate("one", first); err != nil {
			t.Fatalf("a second run must change nothing: %v", err)
		}
		if got := count(t, db, "a"); got != 1 {
			t.Fatalf("migration ran %d times", got)
		}
		if err := db.Migrate("one", append(first, `INSERT INTO a VALUES (2)`)); err != nil {
			t.Fatal(err)
		}
		if got := count(t, db, "a"); got != 2 {
			t.Fatalf("rows: %d", got)
		}
		// The same version number under another owner is a different migration.
		if err := db.Migrate("two", []string{`INSERT INTO a VALUES (3)`}); err != nil {
			t.Fatal(err)
		}
		if got := count(t, db, "a"); got != 3 {
			t.Fatalf("rows: %d", got)
		}
	})
}

func TestFailedMigrationRollsBackAndNamesItself(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		good := `CREATE TABLE a (id INTEGER)`
		bad := `CREATE TABLE half (id INTEGER); INSERT INTO a VALUES (1); THIS IS NOT SQL`
		err := db.Migrate("owner", []string{good, bad, `CREATE TABLE never (id INTEGER)`})
		if err == nil || !strings.Contains(err.Error(), "owner to version 2") {
			t.Fatalf("error: %v", err)
		}
		if got := count(t, db, "a"); got != 0 {
			t.Fatalf("the failed migration left %d rows", got)
		}
		var table string
		probe := db.SQL().QueryRow(`SELECT 'exists' FROM half`).Scan(&table)
		if probe == nil || errors.Is(probe, sql.ErrNoRows) {
			t.Fatalf("the failed migration left its table: %v", probe)
		}
		if probe := db.SQL().QueryRow(`SELECT 'exists' FROM never`).Scan(&table); probe == nil || errors.Is(probe, sql.ErrNoRows) {
			t.Fatalf("a later migration ran after the failure: %v", probe)
		}
		// The fixed list carries on from version 2.
		if err := db.Migrate("owner", []string{good, `CREATE TABLE half (id INTEGER)`}); err != nil {
			t.Fatal(err)
		}
		if got := count(t, db, "half"); got != 0 {
			t.Fatalf("rows: %d", got)
		}
	})
}

func TestMigrateRefusesWhatItCannotTrust(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		if err := db.Migrate(" ", []string{`CREATE TABLE a (id INTEGER)`}); err == nil {
			t.Fatal("an empty owner was accepted")
		}
		if err := db.Migrate("owner", []string{`CREATE TABLE a (id INTEGER)`, `CREATE TABLE b (id INTEGER)`}); err != nil {
			t.Fatal(err)
		}
		err := db.Migrate("owner", []string{`CREATE TABLE a (id INTEGER)`})
		if err == nil || !strings.Contains(err.Error(), "only knows 1") {
			t.Fatalf("an older build must not run on a newer schema: %v", err)
		}
		if err := db.Migrate("blank", []string{"  "}); err == nil {
			t.Fatal("an empty migration was accepted")
		}
	})
}

func TestMigrateReportsADeadConnection(t *testing.T) {
	db := databasetest.SQLite(t)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate("owner", []string{`CREATE TABLE a (id INTEGER)`}); err == nil {
		t.Fatal("expected an error from a closed connection")
	}
}

func TestConcurrentMigrationsRunOnce(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		migrations := []string{`CREATE TABLE a (id INTEGER); INSERT INTO a VALUES (1)`}
		results := make(chan error, 4)
		for range cap(results) {
			go func() { results <- db.Migrate("owner", migrations) }()
		}
		for range cap(results) {
			if err := <-results; err != nil {
				t.Fatal(err)
			}
		}
		if got := count(t, db, "a"); got != 1 {
			t.Fatalf("migration ran %d times", got)
		}
	})
}

func TestOpenReportsFailureAndClosesThePool(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	path := filepath.Join(t.TempDir(), "missing", "plugins.db")
	if _, err := database.Open(ctx, database.Config{Type: "sqlite", Path: path}); err == nil {
		t.Fatal("expected an error for a file that cannot be created")
	}
}
