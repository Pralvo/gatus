package sqlstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const reportColumns = `id, title, stage, published_at, resolved_at, created_by, created_at, updated_at`

func scanReport(row scanner) (*record.Report, error) {
	var report record.Report
	var published, resolved sql.NullInt64
	var createdAt, updatedAt int64
	if err := row.Scan(&report.ID, &report.Title, &report.Stage, &published, &resolved, &report.CreatedBy, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	report.PublishedAt, report.ResolvedAt = optionalTime(published), optionalTime(resolved)
	report.CreatedAt, report.UpdatedAt = fromMillis(createdAt), fromMillis(updatedAt)
	report.Endpoints, report.Updates = []record.AffectedEndpoint{}, []record.ReportUpdate{}
	return &report, nil
}

// CreateReport implements record.Store.
func (s *Store) CreateReport(ctx context.Context, report *record.Report) error {
	return s.inTx(ctx, func(tx session) error {
		err := tx.exec(ctx, `INSERT INTO status_reports (`+reportColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			report.ID, report.Title, string(report.Stage), optionalMillis(report.PublishedAt), optionalMillis(report.ResolvedAt),
			report.CreatedBy, millis(report.CreatedAt), millis(report.UpdatedAt))
		if err != nil {
			return fmt.Errorf("incidents store: insert report: %w", err)
		}
		if err := writeEndpoints(ctx, tx, report.ID, report.Endpoints); err != nil {
			return err
		}
		return addUpdates(ctx, tx, report.ID, report.Updates, 0)
	})
}

func writeEndpoints(ctx context.Context, tx session, reportID string, endpoints []record.AffectedEndpoint) error {
	for _, endpoint := range endpoints {
		err := tx.exec(ctx, `INSERT INTO status_report_endpoints (report_id, endpoint_key, impact) VALUES (?, ?, ?)`, reportID, endpoint.Key, string(endpoint.Impact))
		if err != nil {
			return fmt.Errorf("incidents store: add endpoint: %w", err)
		}
	}
	return nil
}

// addUpdates saves every update with Seq 0, numbering them after last.
func addUpdates(ctx context.Context, tx session, reportID string, updates []record.ReportUpdate, last int) error {
	for i := range updates {
		if updates[i].Seq != 0 {
			continue
		}
		last++
		updates[i].Seq = last
		u := updates[i]
		err := tx.exec(ctx, `INSERT INTO status_report_updates (report_id, seq, happened_at, actor, stage, message) VALUES (?, ?, ?, ?, ?, ?)`,
			reportID, u.Seq, millis(u.At), u.Actor, string(u.Stage), u.Message)
		if err != nil {
			return fmt.Errorf("incidents store: add update: %w", err)
		}
	}
	return nil
}

// Report implements record.Store.
func (s *Store) Report(ctx context.Context, id string) (*record.Report, error) {
	return readFullReport(ctx, s.pool(), id, "")
}

func readFullReport(ctx context.Context, from session, id, lock string) (*record.Report, error) {
	report, err := scanReport(from.row(ctx, `SELECT `+reportColumns+` FROM status_reports WHERE id = ?`+lock, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: report %s", record.ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("incidents store: read report: %w", err)
	}
	byID := map[string]*record.Report{id: report}
	if err := readEndpoints(ctx, from, byID); err != nil {
		return nil, err
	}
	rows, err := from.query(ctx, `SELECT report_id, seq, happened_at, actor, stage, message FROM status_report_updates WHERE report_id = ? ORDER BY seq`, id)
	if err != nil {
		return nil, fmt.Errorf("incidents store: read updates: %w", err)
	}
	return report, scanUpdates(rows, byID)
}

func readEndpoints(ctx context.Context, from session, byID map[string]*record.Report) error {
	marks, args := placeholders(keys(byID))
	rows, err := from.query(ctx, `SELECT report_id, endpoint_key, impact FROM status_report_endpoints WHERE report_id IN (`+marks+`) ORDER BY report_id, endpoint_key`, args...)
	if err != nil {
		return fmt.Errorf("incidents store: read endpoints: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var endpoint record.AffectedEndpoint
		if err := rows.Scan(&id, &endpoint.Key, &endpoint.Impact); err != nil {
			return fmt.Errorf("incidents store: read endpoints: %w", err)
		}
		byID[id].Endpoints = append(byID[id].Endpoints, endpoint)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("incidents store: read endpoints: %w", err)
	}
	return nil
}

func scanUpdates(rows *sql.Rows, byID map[string]*record.Report) error {
	defer rows.Close()
	for rows.Next() {
		var id string
		var update record.ReportUpdate
		var at int64
		if err := rows.Scan(&id, &update.Seq, &at, &update.Actor, &update.Stage, &update.Message); err != nil {
			return fmt.Errorf("incidents store: read updates: %w", err)
		}
		update.At = fromMillis(at)
		byID[id].Updates = append(byID[id].Updates, update)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("incidents store: read updates: %w", err)
	}
	return nil
}

func keys(byID map[string]*record.Report) []string {
	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	return ids
}

// Reports implements record.Store.
func (s *Store) Reports(ctx context.Context, filter record.ReportFilter) ([]*record.Report, error) {
	var conditions []string
	var args []any
	if filter.PublishedOnly {
		conditions = append(conditions, `published_at IS NOT NULL`)
	}
	if filter.Stage != "" {
		conditions = append(conditions, `stage = ?`)
		args = append(args, string(filter.Stage))
	}
	if !filter.ResolvedSince.IsZero() {
		conditions = append(conditions, `(resolved_at IS NULL OR resolved_at >= ?)`)
		args = append(args, millis(filter.ResolvedSince))
	}
	query := `SELECT ` + reportColumns + ` FROM status_reports`
	if len(conditions) > 0 {
		query += ` WHERE ` + strings.Join(conditions, ` AND `)
	}
	query += ` ORDER BY CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END, updated_at DESC, id LIMIT ? OFFSET ?`
	session := s.pool()
	reports, err := listReports(ctx, session, query, append(args, filter.Limit, filter.Offset))
	if err != nil || len(reports) == 0 {
		return reports, err
	}
	byID := make(map[string]*record.Report, len(reports))
	for _, report := range reports {
		byID[report.ID] = report
	}
	if err := readEndpoints(ctx, session, byID); err != nil {
		return nil, err
	}
	marks, ids := placeholders(keys(byID))
	rows, err := session.query(ctx, `SELECT u.report_id, u.seq, u.happened_at, u.actor, u.stage, u.message FROM status_report_updates u
		WHERE u.report_id IN (`+marks+`) AND u.seq = (SELECT MAX(l.seq) FROM status_report_updates l WHERE l.report_id = u.report_id)`, ids...)
	if err != nil {
		return nil, fmt.Errorf("incidents store: read latest updates: %w", err)
	}
	return reports, scanUpdates(rows, byID)
}

func listReports(ctx context.Context, from session, query string, args []any) ([]*record.Report, error) {
	rows, err := from.query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("incidents store: list reports: %w", err)
	}
	defer rows.Close()
	reports := []*record.Report{}
	for rows.Next() {
		report, err := scanReport(rows)
		if err != nil {
			return nil, fmt.Errorf("incidents store: list reports: %w", err)
		}
		reports = append(reports, report)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("incidents store: list reports: %w", err)
	}
	return reports, nil
}

// UpdateReport implements record.Store. It only writes the report's own rows, so
// an incident can never move with it.
func (s *Store) UpdateReport(ctx context.Context, id string, edit func(*record.Report) (bool, error)) (*record.Report, error) {
	var updated *record.Report
	err := s.inTx(ctx, func(tx session) error {
		report, err := readFullReport(ctx, tx, id, s.lockClause())
		if err != nil {
			return err
		}
		before := slices.Clone(report.Endpoints)
		last := len(report.Updates)
		if last > 0 {
			last = report.Updates[last-1].Seq
		}
		changed, err := edit(report)
		if err != nil {
			return err
		}
		updated = report
		if !changed {
			return nil
		}
		err = tx.exec(ctx, `UPDATE status_reports SET title = ?, stage = ?, published_at = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
			report.Title, string(report.Stage), optionalMillis(report.PublishedAt), optionalMillis(report.ResolvedAt), millis(report.UpdatedAt), id)
		if err != nil {
			return fmt.Errorf("incidents store: update report: %w", err)
		}
		if !slices.Equal(before, report.Endpoints) {
			if err := tx.exec(ctx, `DELETE FROM status_report_endpoints WHERE report_id = ?`, id); err != nil {
				return fmt.Errorf("incidents store: replace endpoints: %w", err)
			}
			if err := writeEndpoints(ctx, tx, id, report.Endpoints); err != nil {
				return err
			}
		}
		return addUpdates(ctx, tx, id, report.Updates, last)
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}
