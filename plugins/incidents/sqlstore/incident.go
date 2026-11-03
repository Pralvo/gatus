package sqlstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const incidentColumns = `id, title, severity, commander, state, postmortem, report_id, created_by, created_at, updated_at`

type scanner interface{ Scan(dest ...any) error }

func scanIncident(row scanner) (*record.Incident, error) {
	var incident record.Incident
	var createdAt, updatedAt int64
	err := row.Scan(&incident.ID, &incident.Title, &incident.Severity, &incident.Commander, &incident.State,
		&incident.Postmortem, &incident.ReportID, &incident.CreatedBy, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	incident.CreatedAt, incident.UpdatedAt = fromMillis(createdAt), fromMillis(updatedAt)
	return &incident, nil
}

// CreateIncident implements record.Store.
func (s *Store) CreateIncident(ctx context.Context, incident *record.Incident) error {
	return s.inTx(ctx, func(tx session) error {
		err := tx.exec(ctx, `INSERT INTO incident_records (`+incidentColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			incident.ID, incident.Title, string(incident.Severity), incident.Commander, string(incident.State),
			incident.Postmortem, incident.ReportID, incident.CreatedBy, millis(incident.CreatedAt), millis(incident.UpdatedAt))
		if err != nil {
			return fmt.Errorf("incidents store: insert incident: %w", err)
		}
		return addEntries(ctx, tx, incident.ID, 0, incident.Timeline)
	})
}

// addEntries numbers entries after last and saves them.
func addEntries(ctx context.Context, tx session, incidentID string, last int, entries []record.TimelineEntry) error {
	for i := range entries {
		entries[i].Seq = last + i + 1
		e := entries[i]
		err := tx.exec(ctx, `INSERT INTO incident_timeline (incident_id, seq, happened_at, actor, kind, from_value, to_value, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			incidentID, e.Seq, millis(e.At), e.Actor, string(e.Kind), e.From, e.To, e.Note)
		if err != nil {
			return fmt.Errorf("incidents store: add timeline entry: %w", err)
		}
	}
	return nil
}

// Incident implements record.Store.
func (s *Store) Incident(ctx context.Context, id string) (*record.Incident, error) {
	session := s.pool()
	incident, err := readIncident(ctx, session, id, "")
	if err != nil {
		return nil, err
	}
	if incident.Timeline, err = readTimeline(ctx, session, id); err != nil {
		return nil, err
	}
	return incident, nil
}

func readIncident(ctx context.Context, from session, id, lock string) (*record.Incident, error) {
	incident, err := scanIncident(from.row(ctx, `SELECT `+incidentColumns+` FROM incident_records WHERE id = ?`+lock, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("%w: incident %s", record.ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("incidents store: read incident: %w", err)
	}
	return incident, nil
}

func readTimeline(ctx context.Context, from session, id string) ([]record.TimelineEntry, error) {
	rows, err := from.query(ctx, `SELECT seq, happened_at, actor, kind, from_value, to_value, note FROM incident_timeline WHERE incident_id = ? ORDER BY seq`, id)
	if err != nil {
		return nil, fmt.Errorf("incidents store: read timeline: %w", err)
	}
	defer rows.Close()
	var entries []record.TimelineEntry
	for rows.Next() {
		var e record.TimelineEntry
		var at int64
		if err := rows.Scan(&e.Seq, &at, &e.Actor, &e.Kind, &e.From, &e.To, &e.Note); err != nil {
			return nil, fmt.Errorf("incidents store: read timeline: %w", err)
		}
		e.At = fromMillis(at)
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("incidents store: read timeline: %w", err)
	}
	return entries, nil
}

// Incidents implements record.Store.
func (s *Store) Incidents(ctx context.Context, filter record.IncidentFilter) ([]*record.Incident, error) {
	query := `SELECT ` + incidentColumns + ` FROM incident_records`
	var args []any
	if filter.State != "" {
		query += ` WHERE state = ?`
		args = append(args, string(filter.State))
	}
	rows, err := s.pool().query(ctx, query+` ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, append(args, filter.Limit, filter.Offset)...)
	if err != nil {
		return nil, fmt.Errorf("incidents store: list incidents: %w", err)
	}
	defer rows.Close()
	incidents := []*record.Incident{}
	for rows.Next() {
		incident, err := scanIncident(rows)
		if err != nil {
			return nil, fmt.Errorf("incidents store: list incidents: %w", err)
		}
		incidents = append(incidents, incident)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("incidents store: list incidents: %w", err)
	}
	return incidents, nil
}

// UpdateIncident implements record.Store. It only writes the incident's own row
// and timeline, so a report can never move with it.
func (s *Store) UpdateIncident(ctx context.Context, id string, edit func(*record.Incident) ([]record.TimelineEntry, error)) (*record.Incident, error) {
	var updated *record.Incident
	err := s.inTx(ctx, func(tx session) error {
		incident, err := readIncident(ctx, tx, id, s.lockClause())
		if err != nil {
			return err
		}
		entries, err := edit(incident)
		if err != nil {
			return err
		}
		if len(entries) > 0 {
			err := tx.exec(ctx, `UPDATE incident_records SET title = ?, severity = ?, commander = ?, state = ?, postmortem = ?, report_id = ?, updated_at = ? WHERE id = ?`,
				incident.Title, string(incident.Severity), incident.Commander, string(incident.State), incident.Postmortem, incident.ReportID, millis(incident.UpdatedAt), id)
			if err != nil {
				return fmt.Errorf("incidents store: update incident: %w", err)
			}
			var last int
			if err := tx.row(ctx, `SELECT COALESCE(MAX(seq), 0) FROM incident_timeline WHERE incident_id = ?`, id).Scan(&last); err != nil {
				return fmt.Errorf("incidents store: read timeline position: %w", err)
			}
			if err := addEntries(ctx, tx, id, last, entries); err != nil {
				return err
			}
		}
		if incident.Timeline, err = readTimeline(ctx, tx, id); err != nil {
			return err
		}
		updated = incident
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}
