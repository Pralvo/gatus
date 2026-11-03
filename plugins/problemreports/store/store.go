// Package store keeps problem reports in the database plugin's connection, on
// SQLite or Postgres. A row holds only what a report needs: no address, no raw
// User-Agent and nothing that identifies a device.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database"
)

// ErrNotFound means no report has that reference.
var ErrNotFound = errors.New("no such problem report")

const migrationOwner = "problem-reports"

// migrations must only grow at the end. Times are UTC milliseconds since the
// epoch, which sort and compare the same on both databases.
var migrations = []string{`
CREATE TABLE problem_reports (
	id            TEXT PRIMARY KEY,
	received_at   BIGINT  NOT NULL,
	service       TEXT    NOT NULL,
	page          TEXT    NOT NULL,
	description   TEXT    NOT NULL,
	details       TEXT    NOT NULL,
	country       TEXT    NOT NULL,
	browser       TEXT    NOT NULL,
	browser_major INTEGER NOT NULL,
	os            TEXT    NOT NULL
);
CREATE INDEX problem_reports_by_time ON problem_reports (received_at);
`}

// Report is one stored report. Every field is listed in
// docs/privacy/problem-reports.md; a new one needs an entry there first.
type Report struct {
	ID           string
	ReceivedAt   time.Time
	Service      string
	Page         string
	Description  string
	Details      string
	Country      string
	Browser      string
	BrowserMajor int
	OS           string
}

// Filter narrows a list. Empty strings and zero times match everything. From is
// inclusive and To is exclusive.
type Filter struct {
	Service string
	Country string
	From    time.Time
	To      time.Time
	Limit   int
	Offset  int
}

// Count is how many reports share a key, such as a country.
type Count struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

// Store reads and writes reports.
type Store struct {
	db *database.DB
}

// New returns a Store. Call Migrate before using it.
func New(db *database.DB) *Store { return &Store{db: db} }

// Migrate brings the table up to date.
func (s *Store) Migrate() error { return s.db.Migrate(migrationOwner, migrations) }

const columns = "id, received_at, service, page, description, details, country, browser, browser_major, os"

// Add saves a report.
func (s *Store) Add(ctx context.Context, r Report) error {
	_, err := s.db.SQL().ExecContext(ctx, s.db.Rebind("INSERT INTO problem_reports ("+columns+") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
		r.ID, r.ReceivedAt.UnixMilli(), r.Service, r.Page, r.Description, r.Details, r.Country, r.Browser, r.BrowserMajor, r.OS)
	if err != nil {
		return fmt.Errorf("problem reports store: add: %w", err)
	}
	return nil
}

// List returns reports newest first, and whether more follow.
func (s *Store) List(ctx context.Context, f Filter) ([]Report, bool, error) {
	where, args := f.where()
	args = append(args, f.Limit+1, f.Offset)
	rows, err := s.db.SQL().QueryContext(ctx, s.db.Rebind("SELECT "+columns+" FROM problem_reports"+where+" ORDER BY received_at DESC, id LIMIT ? OFFSET ?"), args...)
	if err != nil {
		return nil, false, fmt.Errorf("problem reports store: list: %w", err)
	}
	defer func() { _ = rows.Close() }()
	reports := []Report{}
	for rows.Next() {
		r, err := scan(rows)
		if err != nil {
			return nil, false, err
		}
		reports = append(reports, r)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("problem reports store: list: %w", err)
	}
	more := len(reports) > f.Limit
	if more {
		reports = reports[:f.Limit]
	}
	return reports, more, nil
}

func (f Filter) where() (string, []any) {
	var clauses []string
	var args []any
	add := func(clause string, value any) {
		clauses = append(clauses, clause)
		args = append(args, value)
	}
	if f.Service != "" {
		add("service = ?", f.Service)
	}
	if f.Country != "" {
		add("country = ?", f.Country)
	}
	if !f.From.IsZero() {
		add("received_at >= ?", f.From.UnixMilli())
	}
	if !f.To.IsZero() {
		add("received_at < ?", f.To.UnixMilli())
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

type scanner interface{ Scan(dest ...any) error }

func scan(row scanner) (Report, error) {
	var r Report
	var received int64
	err := row.Scan(&r.ID, &received, &r.Service, &r.Page, &r.Description, &r.Details, &r.Country, &r.Browser, &r.BrowserMajor, &r.OS)
	if errors.Is(err, sql.ErrNoRows) {
		return Report{}, ErrNotFound
	}
	if err != nil {
		return Report{}, fmt.Errorf("problem reports store: read: %w", err)
	}
	r.ReceivedAt = time.UnixMilli(received).UTC()
	return r, nil
}

// Get returns one report.
func (s *Store) Get(ctx context.Context, id string) (Report, error) {
	return scan(s.db.SQL().QueryRowContext(ctx, s.db.Rebind("SELECT "+columns+" FROM problem_reports WHERE id = ?"), id))
}

// Delete removes one report for good.
func (s *Store) Delete(ctx context.Context, id string) error {
	result, err := s.db.SQL().ExecContext(ctx, s.db.Rebind("DELETE FROM problem_reports WHERE id = ?"), id)
	if err != nil {
		return fmt.Errorf("problem reports store: delete: %w", err)
	}
	if n, err := result.RowsAffected(); err == nil && n == 0 {
		return ErrNotFound
	}
	return nil
}

// Purge removes every report received before the cutoff and says how many went.
func (s *Store) Purge(ctx context.Context, before time.Time) (int64, error) {
	result, err := s.db.SQL().ExecContext(ctx, s.db.Rebind("DELETE FROM problem_reports WHERE received_at < ?"), before.UnixMilli())
	if err != nil {
		return 0, fmt.Errorf("problem reports store: purge: %w", err)
	}
	return result.RowsAffected()
}

// Summary counts reports received from since onwards, by country and by service,
// largest first. An empty key means the report had no country or no service.
func (s *Store) Summary(ctx context.Context, since time.Time) (byCountry, byService []Count, err error) {
	if byCountry, err = s.count(ctx, "country", since); err != nil {
		return nil, nil, err
	}
	if byService, err = s.count(ctx, "service", since); err != nil {
		return nil, nil, err
	}
	return byCountry, byService, nil
}

// count groups by column, which is one of two constants above and never input.
func (s *Store) count(ctx context.Context, column string, since time.Time) ([]Count, error) {
	query := "SELECT " + column + ", COUNT(*) AS n FROM problem_reports WHERE received_at >= ? GROUP BY " + column + " ORDER BY n DESC, " + column
	rows, err := s.db.SQL().QueryContext(ctx, s.db.Rebind(query), since.UnixMilli())
	if err != nil {
		return nil, fmt.Errorf("problem reports store: summary: %w", err)
	}
	defer func() { _ = rows.Close() }()
	counts := []Count{}
	for rows.Next() {
		var c Count
		if err := rows.Scan(&c.Key, &c.Count); err != nil {
			return nil, fmt.Errorf("problem reports store: summary: %w", err)
		}
		counts = append(counts, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("problem reports store: summary: %w", err)
	}
	return counts, nil
}

// Columns returns the table's column names, so a test can check that nothing
// beyond the documented fields is ever stored.
func (s *Store) Columns(ctx context.Context) ([]string, error) {
	rows, err := s.db.SQL().QueryContext(ctx, "SELECT * FROM problem_reports WHERE 1 = 0")
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return rows.Columns()
}
