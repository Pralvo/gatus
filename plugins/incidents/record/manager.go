package record

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"
)

// Manager is the Service. It holds the rules, and the Store only saves.
type Manager struct {
	store         Store
	now           func() time.Time
	publish       func(topic string, data any)
	knownEndpoint func(key string) bool
}

var _ Service = (*Manager)(nil)

// NewManager returns a Manager. publish receives each event after its write
// commits. knownEndpoint says whether a key is in the current configuration.
func NewManager(store Store, now func() time.Time, publish func(topic string, data any), knownEndpoint func(key string) bool) *Manager {
	return &Manager{store: store, now: now, publish: publish, knownEndpoint: knownEndpoint}
}

// clock returns the time in the precision the store keeps, so a record reads back
// exactly as it was returned.
func (m *Manager) clock() time.Time { return m.now().UTC().Truncate(time.Millisecond) }

// CreateIncident implements Service.
func (m *Manager) CreateIncident(ctx context.Context, actor string, input NewIncident) (*Incident, error) {
	err := errors.Join(checkActor(actor), checkTitle(input.Title), checkSeverity(input.Severity), checkLine("commander", input.Commander, MaxNameLength))
	if err != nil {
		return nil, err
	}
	if err := m.checkReportLink(ctx, input.ReportID); err != nil {
		return nil, err
	}
	at := m.clock()
	incident := &Incident{
		ID: NewID(), Title: input.Title, Severity: input.Severity, Commander: input.Commander,
		State: StateOpen, ReportID: input.ReportID, CreatedBy: actor, CreatedAt: at, UpdatedAt: at,
		Timeline: []TimelineEntry{{At: at, Actor: actor, Kind: EntryCreated, To: string(StateOpen)}},
	}
	if input.ReportID != "" {
		incident.Timeline = append(incident.Timeline, TimelineEntry{At: at, Actor: actor, Kind: EntryReportLink, To: input.ReportID})
	}
	if err := m.store.CreateIncident(ctx, incident); err != nil {
		return nil, err
	}
	m.publishIncident(TopicIncidentCreated, actor, incident, len(incident.Timeline))
	return incident, nil
}

// GetIncident implements Service.
func (m *Manager) GetIncident(ctx context.Context, id string) (*Incident, error) {
	if !ValidID(id) {
		return nil, fmt.Errorf("%w: incident %q", ErrNotFound, id)
	}
	return m.store.Incident(ctx, id)
}

// ListIncidents implements Service.
func (m *Manager) ListIncidents(ctx context.Context, filter IncidentFilter) ([]*Incident, error) {
	if filter.State != "" && !filter.State.valid() {
		return nil, invalid("state is not a known state")
	}
	var err error
	if filter.Limit, filter.Offset, err = bound(filter.Limit, filter.Offset); err != nil {
		return nil, err
	}
	return m.store.Incidents(ctx, filter)
}

// ChangeIncident implements Service.
func (m *Manager) ChangeIncident(ctx context.Context, actor, id string, change IncidentChange) (*Incident, error) {
	if err := checkIncidentChange(change); err != nil {
		return nil, err
	}
	if change.ReportID != nil {
		if err := m.checkReportLink(ctx, *change.ReportID); err != nil {
			return nil, err
		}
	}
	return m.editIncident(ctx, actor, id, TopicIncidentChanged, func(incident *Incident) ([]TimelineEntry, error) {
		var entries []TimelineEntry
		set := func(kind EntryKind, field *string, value *string) {
			if value != nil && *field != *value {
				entries = append(entries, TimelineEntry{Kind: kind, From: *field, To: *value})
				*field = *value
			}
		}
		set(EntryTitle, &incident.Title, change.Title)
		set(EntryCommander, &incident.Commander, change.Commander)
		set(EntryReportLink, &incident.ReportID, change.ReportID)
		if change.Severity != nil && incident.Severity != *change.Severity {
			entries = append(entries, TimelineEntry{Kind: EntrySeverity, From: string(incident.Severity), To: string(*change.Severity)})
			incident.Severity = *change.Severity
		}
		if change.Postmortem != nil && incident.Postmortem != *change.Postmortem {
			// The entry records that it changed. The text itself lives on the incident.
			entries = append(entries, TimelineEntry{Kind: EntryPostmortem})
			incident.Postmortem = *change.Postmortem
		}
		return entries, nil
	})
}

func checkIncidentChange(change IncidentChange) error {
	var errs []error
	if change.Title != nil {
		errs = append(errs, checkTitle(*change.Title))
	}
	if change.Severity != nil {
		errs = append(errs, checkSeverity(*change.Severity))
	}
	if change.Commander != nil {
		errs = append(errs, checkLine("commander", *change.Commander, MaxNameLength))
	}
	if change.Postmortem != nil {
		errs = append(errs, checkBlock("postmortem", *change.Postmortem, MaxPostmortemLength))
	}
	return errors.Join(errs...)
}

// SetIncidentState implements Service.
func (m *Manager) SetIncidentState(ctx context.Context, actor, id string, state State) (*Incident, error) {
	if !state.valid() {
		return nil, invalid("state is not a known state")
	}
	return m.editIncident(ctx, actor, id, TopicIncidentStateChanged, func(incident *Incident) ([]TimelineEntry, error) {
		if !CanMove(incident.State, state) {
			return nil, fmt.Errorf("%w: from %s to %s", ErrInvalidTransition, incident.State, state)
		}
		entry := TimelineEntry{Kind: EntryState, From: string(incident.State), To: string(state)}
		incident.State = state
		return []TimelineEntry{entry}, nil
	})
}

// AddIncidentNote implements Service.
func (m *Manager) AddIncidentNote(ctx context.Context, actor, id, note string) (*Incident, error) {
	if err := checkMessage("note", note); err != nil {
		return nil, err
	}
	return m.editIncident(ctx, actor, id, TopicIncidentNoteAdded, func(*Incident) ([]TimelineEntry, error) {
		return []TimelineEntry{{Kind: EntryNote, Note: note}}, nil
	})
}

// editIncident applies every rule shared by incident changes: the actor, the
// frozen check inside the transaction, and the event after it commits.
func (m *Manager) editIncident(ctx context.Context, actor, id, topic string, edit func(*Incident) ([]TimelineEntry, error)) (*Incident, error) {
	if err := checkActor(actor); err != nil {
		return nil, err
	}
	if !ValidID(id) {
		return nil, fmt.Errorf("%w: incident %q", ErrNotFound, id)
	}
	added := 0
	incident, err := m.store.UpdateIncident(ctx, id, func(incident *Incident) ([]TimelineEntry, error) {
		if incident.State == StateClosed {
			return nil, ErrFrozen
		}
		entries, err := edit(incident)
		if err != nil {
			return nil, err
		}
		at := m.clock()
		for i := range entries {
			entries[i].At, entries[i].Actor = at, actor
		}
		if len(entries) > 0 {
			incident.UpdatedAt = at
		}
		added = len(entries)
		return entries, nil
	})
	if err != nil {
		return nil, err
	}
	if added > 0 {
		m.publishIncident(topic, actor, incident, added)
	}
	return incident, nil
}

func (m *Manager) checkReportLink(ctx context.Context, reportID string) error {
	if reportID == "" {
		return nil
	}
	if ValidID(reportID) {
		_, err := m.store.Report(ctx, reportID)
		if !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return invalid("report_id names no report")
}

func (m *Manager) publishIncident(topic, actor string, incident *Incident, added int) {
	snapshot := *incident
	snapshot.Timeline = slices.Clone(incident.Timeline)
	m.publish(topic, IncidentEvent{Actor: actor, Incident: snapshot, Entries: snapshot.Timeline[len(snapshot.Timeline)-added:]})
}

// CreateReport implements Service.
func (m *Manager) CreateReport(ctx context.Context, actor string, input NewReport) (*Report, error) {
	err := errors.Join(checkActor(actor), checkTitle(input.Title), checkStage(input.Stage), checkMessage("message", input.Message), m.checkEndpoints(input.Endpoints, nil))
	if err != nil {
		return nil, err
	}
	at := m.clock()
	report := &Report{
		ID: NewID(), Title: input.Title, Stage: input.Stage, Endpoints: sortedEndpoints(input.Endpoints),
		Updates:   []ReportUpdate{{At: at, Actor: actor, Stage: input.Stage, Message: input.Message}},
		CreatedBy: actor, CreatedAt: at, UpdatedAt: at,
	}
	if input.Stage == StageResolved {
		report.ResolvedAt = &at
	}
	if input.Published {
		report.PublishedAt = &at
	}
	if err := m.store.CreateReport(ctx, report); err != nil {
		return nil, err
	}
	m.publishReport(TopicReportCreated, actor, report, false)
	if input.Published {
		m.publishReport(TopicReportPublished, actor, report, false)
	}
	return report, nil
}

// GetReport implements Service.
func (m *Manager) GetReport(ctx context.Context, id string) (*Report, error) {
	if !ValidID(id) {
		return nil, fmt.Errorf("%w: report %q", ErrNotFound, id)
	}
	return m.store.Report(ctx, id)
}

// ListReports implements Service.
func (m *Manager) ListReports(ctx context.Context, filter ReportFilter) ([]*Report, error) {
	if filter.Stage != "" {
		if err := checkStage(filter.Stage); err != nil {
			return nil, err
		}
	}
	var err error
	if filter.Limit, filter.Offset, err = bound(filter.Limit, filter.Offset); err != nil {
		return nil, err
	}
	return m.store.Reports(ctx, filter)
}

// ChangeReport implements Service.
func (m *Manager) ChangeReport(ctx context.Context, actor, id string, change ReportChange) (*Report, error) {
	if change.Title != nil {
		if err := checkTitle(*change.Title); err != nil {
			return nil, err
		}
	}
	return m.editReport(ctx, actor, id, TopicReportChanged, false, func(report *Report, _ time.Time) (bool, error) {
		changed := false
		if change.Title != nil && report.Title != *change.Title {
			report.Title, changed = *change.Title, true
		}
		if change.Endpoints != nil {
			if err := m.checkEndpoints(change.Endpoints, report.Endpoints); err != nil {
				return false, err
			}
			if sorted := sortedEndpoints(change.Endpoints); !slices.Equal(report.Endpoints, sorted) {
				report.Endpoints, changed = sorted, true
			}
		}
		return changed, nil
	})
}

// AddReportUpdate implements Service.
func (m *Manager) AddReportUpdate(ctx context.Context, actor, id string, update NewReportUpdate) (*Report, error) {
	if err := errors.Join(checkStage(update.Stage), checkMessage("message", update.Message)); err != nil {
		return nil, err
	}
	return m.editReport(ctx, actor, id, TopicReportUpdateAdded, true, func(report *Report, at time.Time) (bool, error) {
		report.Updates = append(report.Updates, ReportUpdate{At: at, Actor: actor, Stage: update.Stage, Message: update.Message})
		report.Stage = update.Stage
		switch {
		case update.Stage != StageResolved:
			report.ResolvedAt = nil
		case report.ResolvedAt == nil:
			report.ResolvedAt = &at
		}
		return true, nil
	})
}

// SetReportPublished implements Service.
func (m *Manager) SetReportPublished(ctx context.Context, actor, id string, published bool) (*Report, error) {
	topic := TopicReportUnpublished
	if published {
		topic = TopicReportPublished
	}
	return m.editReport(ctx, actor, id, topic, false, func(report *Report, at time.Time) (bool, error) {
		if report.Published() == published {
			return false, nil
		}
		report.PublishedAt = nil
		if published {
			report.PublishedAt = &at
		}
		return true, nil
	})
}

func (m *Manager) editReport(ctx context.Context, actor, id, topic string, withUpdate bool, edit func(*Report, time.Time) (bool, error)) (*Report, error) {
	if err := checkActor(actor); err != nil {
		return nil, err
	}
	if !ValidID(id) {
		return nil, fmt.Errorf("%w: report %q", ErrNotFound, id)
	}
	changed := false
	report, err := m.store.UpdateReport(ctx, id, func(report *Report) (bool, error) {
		at := m.clock()
		var err error
		if changed, err = edit(report, at); err != nil {
			return false, err
		}
		if changed {
			report.UpdatedAt = at
		}
		return changed, nil
	})
	if err != nil {
		return nil, err
	}
	if changed {
		m.publishReport(topic, actor, report, withUpdate)
	}
	return report, nil
}

// checkEndpoints validates a list against the configuration. A key the report
// already holds may stay after its endpoint leaves the configuration, so a report
// can still be edited once that happens.
func (m *Manager) checkEndpoints(endpoints, stored []AffectedEndpoint) error {
	if len(endpoints) > MaxEndpoints {
		return invalid("a report can name at most %d endpoints", MaxEndpoints)
	}
	seen := make(map[string]bool, len(endpoints))
	for _, endpoint := range endpoints {
		if err := checkLine("endpoint key", endpoint.Key, MaxEndpointKey); err != nil {
			return err
		}
		if !endpoint.Impact.valid() {
			return invalid("impact must be degraded, partial, major or maintenance")
		}
		if seen[endpoint.Key] {
			return invalid("endpoint %q is listed twice", endpoint.Key)
		}
		seen[endpoint.Key] = true
		held := slices.ContainsFunc(stored, func(s AffectedEndpoint) bool { return s.Key == endpoint.Key })
		if !held && !m.knownEndpoint(endpoint.Key) {
			return fmt.Errorf("%w: %q", ErrUnknownEndpoint, endpoint.Key)
		}
	}
	return nil
}

func sortedEndpoints(endpoints []AffectedEndpoint) []AffectedEndpoint {
	sorted := slices.Clone(endpoints)
	if sorted == nil {
		sorted = []AffectedEndpoint{}
	}
	slices.SortFunc(sorted, func(a, b AffectedEndpoint) int { return cmp.Compare(a.Key, b.Key) })
	return sorted
}

func (m *Manager) publishReport(topic, actor string, report *Report, withUpdate bool) {
	snapshot := *report
	snapshot.Endpoints = slices.Clone(report.Endpoints)
	snapshot.Updates = slices.Clone(report.Updates)
	event := ReportEvent{Actor: actor, Report: snapshot}
	if withUpdate {
		event.Update = snapshot.LatestUpdate()
	}
	m.publish(topic, event)
}
