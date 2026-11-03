// Package database gives plugins a SQL connection of their own, separate from
// Gatus's history store. It works with SQLite and Postgres. When the database is
// down this plugin keeps retrying and the plugins that need it wait, so stored
// features switch off while the status page stays up.
package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/plugin"
	"github.com/lib/pq"
	_ "modernc.org/sqlite" // registers the sqlite driver
)

// Key is the service this plugin provides. Its value is a *DB.
const Key plugin.Key = "database"

// Dialect names a supported database.
type Dialect string

const (
	// SQLite stores data in a local file.
	SQLite Dialect = "sqlite"
	// Postgres connects to a PostgreSQL server.
	Postgres Dialect = "postgres"
)

// connectTimeout bounds Start, which runs before the status page is served.
const connectTimeout = 5 * time.Second

// retryDelay is how long the host waits before trying a failed connection again.
var retryDelay = 30 * time.Second

// Config is the plugin's config: block.
type Config struct {
	// Type is "sqlite" or "postgres".
	Type string `yaml:"type"`
	// Path is the SQLite file or the Postgres connection string. It can hold a
	// password, so it is never logged.
	Path string `yaml:"path"`
}

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "database",
	Description: "A SQL connection for plugins, separate from Gatus's history store.",
	Provides:    []plugin.Key{Key},
	Start: func(ctx *plugin.Context) error {
		var cfg Config
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		pool, err := cfg.pool()
		if err != nil {
			return err
		}
		ctx.Defer(pool.Close)
		connecting, cancel := context.WithTimeout(ctx.Context(), connectTimeout)
		defer cancel()
		if err := pool.PingContext(connecting); err != nil {
			return plugin.Retry(cfg.redact(err), retryDelay)
		}
		ctx.Provide(Key, &DB{sql: pool, dialect: Dialect(cfg.Type)})
		ctx.Logf("connected to %s", cfg.Type)
		return nil
	},
}

// Open connects without a plugin host, for tests and tools. The caller closes the
// result. Plugins read the service instead.
func Open(ctx context.Context, cfg Config) (*DB, error) {
	pool, err := cfg.pool()
	if err != nil {
		return nil, err
	}
	if err := pool.PingContext(ctx); err != nil {
		_ = pool.Close()
		return nil, cfg.redact(err)
	}
	return &DB{sql: pool, dialect: Dialect(cfg.Type)}, nil
}

// pool validates the configuration and prepares a connection pool. It does not
// connect, so every error here is a configuration mistake that a retry cannot fix.
func (c Config) pool() (*sql.DB, error) {
	if strings.TrimSpace(c.Path) == "" {
		return nil, errors.New("database path is required")
	}
	switch Dialect(c.Type) {
	case SQLite:
		if inMemory(c.Path) {
			return nil, errors.New("database path is an in-memory SQLite database, whose data would vanish on restart")
		}
		pool, err := sql.Open("sqlite", sqliteDSN(c.Path))
		if err != nil {
			return nil, fmt.Errorf("database: %w", err)
		}
		pool.SetMaxOpenConns(4)
		return pool, nil
	case Postgres:
		connector, err := pq.NewConnector(c.Path)
		if err != nil {
			// The parser's message quotes the string, password included, so it is dropped.
			return nil, errors.New("database path is not a valid Postgres connection string")
		}
		pool := sql.OpenDB(connector)
		pool.SetMaxOpenConns(8)
		pool.SetConnMaxIdleTime(5 * time.Minute)
		return pool, nil
	default:
		return nil, fmt.Errorf("database type must be sqlite or postgres, not %q", c.Type)
	}
}

// sqliteDSN adds the settings that make the file safe for several connections.
// A write transaction takes its lock on BEGIN, so a read followed by a write
// inside it can never fail halfway because another writer arrived.
func sqliteDSN(path string) string {
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	return path + separator + "_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_txlock=immediate"
}

// inMemory reports whether a SQLite path would keep its data outside a named file.
func inMemory(path string) bool {
	name, query, _ := strings.Cut(path, "?")
	if strings.Contains(strings.ToLower(name), ":memory:") {
		return true
	}
	name = strings.TrimPrefix(strings.ToLower(name), "file:")
	if strings.TrimSpace(name) == "" {
		return true // SQLite gives an empty name a temporary database
	}
	values, err := url.ParseQuery(query)
	if err != nil {
		return true // an option that cannot be read cannot be shown to be safe
	}
	return strings.EqualFold(values.Get("mode"), "memory") || strings.EqualFold(values.Get("vfs"), "memdb")
}

var keywordPassword = regexp.MustCompile(`(?i)password\s*=\s*('(?:[^'\\]|\\.)*'|\S+)`)

// redact removes the connection string and its password from a driver error.
func (c Config) redact(err error) error {
	if Dialect(c.Type) != Postgres {
		return err
	}
	text := strings.ReplaceAll(err.Error(), c.Path, "[redacted]")
	if parsed, parseErr := url.Parse(c.Path); parseErr == nil && parsed.User != nil {
		if password, ok := parsed.User.Password(); ok && password != "" {
			text = strings.ReplaceAll(text, password, "[redacted]")
		}
	}
	return errors.New(keywordPassword.ReplaceAllString(text, "password=[redacted]"))
}

// DB is the service this plugin provides. Its life belongs to the plugin, so
// consumers must not close it.
type DB struct {
	sql     *sql.DB
	dialect Dialect
}

// SQL returns the connection pool. Pass every query through Rebind first.
func (d *DB) SQL() *sql.DB { return d.sql }

// Dialect says which database this is.
func (d *DB) Dialect() Dialect { return d.dialect }

// Close closes the pool. Only the plugin and callers of Open use it.
func (d *DB) Close() error { return d.sql.Close() }

// Rebind turns the ? placeholders of a query into the form the database wants,
// so one SQL string works on both. A ? inside a quoted string, a quoted
// identifier or a comment stays as it is. A query using Postgres dollar quoting
// is not supported.
func (d *DB) Rebind(query string) string {
	if d.dialect != Postgres {
		return query
	}
	var out strings.Builder
	out.Grow(len(query) + 8)
	number := 0
	for i := 0; i < len(query); i++ {
		switch c := query[i]; {
		case c == '\'' || c == '"':
			end := closingQuote(query, i)
			out.WriteString(query[i:end])
			i = end - 1
		case c == '-' && strings.HasPrefix(query[i:], "--"):
			end := len(query)
			if n := strings.IndexByte(query[i:], '\n'); n >= 0 {
				end = i + n + 1
			}
			out.WriteString(query[i:end])
			i = end - 1
		case c == '/' && strings.HasPrefix(query[i:], "/*"):
			end := len(query)
			if n := strings.Index(query[i:], "*/"); n >= 0 {
				end = i + n + 2
			}
			out.WriteString(query[i:end])
			i = end - 1
		case c == '?':
			number++
			out.WriteByte('$')
			out.WriteString(strconv.Itoa(number))
		default:
			out.WriteByte(c)
		}
	}
	return out.String()
}

// closingQuote returns the index just past the quoted run that starts at start.
// A doubled quote inside the run is an escaped quote, which needs no special
// handling: it reads as one run ending where the next begins.
func closingQuote(query string, start int) int {
	if n := strings.IndexByte(query[start+1:], query[start]); n >= 0 {
		return start + n + 2
	}
	return len(query)
}
