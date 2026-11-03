package record

import (
	"context"
	"errors"
	"time"
)

// Errors a Service returns, each wrapped with detail. Test with errors.Is. Any
// other error means the database failed.
var (
	// ErrNotFound means no record has that ID.
	ErrNotFound = errors.New("not found")
	// ErrInvalid means the input broke a validation rule.
	ErrInvalid = errors.New("invalid input")
	// ErrInvalidTransition means an incident cannot make that state change.
	ErrInvalidTransition = errors.New("invalid state transition")
	// ErrFrozen means the incident is closed, so nothing about it can change.
	ErrFrozen = errors.New("incident is closed")
	// ErrUnknownEndpoint means a key is not in the current configuration.
	ErrUnknownEndpoint = errors.New("unknown endpoint")
)

// NewIncident is the input to CreateIncident.
type NewIncident struct {
	Title     string   `json:"title"`
	Severity  Severity `json:"severity"`
	Commander string   `json:"commander"`
	ReportID  string   `json:"report_id"`
}

// IncidentChange is the input to ChangeIncident. A nil field stays as it is. An
// empty Commander or ReportID clears it.
type IncidentChange struct {
	Title      *string   `json:"title"`
	Severity   *Severity `json:"severity"`
	Commander  *string   `json:"commander"`
	Postmortem *string   `json:"postmortem"`
	ReportID   *string   `json:"report_id"`
}

// IncidentFilter narrows ListIncidents. Results are newest first.
type IncidentFilter struct {
	// State keeps only incidents in that state, if set.
	State State
	// Limit defaults to DefaultLimit and is capped at MaxLimit.
	Limit  int
	Offset int
}

// NewReport is the input to CreateReport. Message becomes the first update.
type NewReport struct {
	Title     string             `json:"title"`
	Stage     Stage              `json:"stage"`
	Message   string             `json:"message"`
	Endpoints []AffectedEndpoint `json:"endpoints"`
	Published bool               `json:"published"`
}

// ReportChange is the input to ChangeReport. A nil field stays as it is. An empty,
// non-nil Endpoints clears the list.
type ReportChange struct {
	Title     *string            `json:"title"`
	Endpoints []AffectedEndpoint `json:"endpoints"`
}

// NewReportUpdate is the input to AddReportUpdate.
type NewReportUpdate struct {
	Stage   Stage  `json:"stage"`
	Message string `json:"message"`
}

// ReportFilter narrows ListReports. Unresolved reports come first, then the most
// recently changed.
type ReportFilter struct {
	// PublishedOnly leaves out drafts. Anything serving the public must set it.
	PublishedOnly bool
	// Stage keeps only reports at that stage, if set.
	Stage Stage
	// ResolvedSince, if set, leaves out reports resolved before it.
	ResolvedSince time.Time
	// Limit defaults to DefaultLimit and is capped at MaxLimit.
	Limit  int
	Offset int
}

// Service is what other plugins use. Read it from the host:
//
//	service := plugin.Get[record.Service](ctx, incidents.Key)
//
// Every write takes the actor to record against it, is atomic, and publishes an
// event after it commits. A write that changes nothing publishes nothing. All
// returned text is untrusted: never render it as HTML unescaped.
type Service interface {
	// CreateIncident opens an incident.
	CreateIncident(ctx context.Context, actor string, input NewIncident) (*Incident, error)
	// GetIncident returns one incident with its whole timeline.
	GetIncident(ctx context.Context, id string) (*Incident, error)
	// ListIncidents returns incidents without their timelines.
	ListIncidents(ctx context.Context, filter IncidentFilter) ([]*Incident, error)
	// ChangeIncident edits fields and records each change on the timeline.
	ChangeIncident(ctx context.Context, actor, id string, change IncidentChange) (*Incident, error)
	// SetIncidentState moves an incident to another state. See CanMove.
	SetIncidentState(ctx context.Context, actor, id string, state State) (*Incident, error)
	// AddIncidentNote adds a note to the timeline.
	AddIncidentNote(ctx context.Context, actor, id, note string) (*Incident, error)

	// CreateReport starts a report. It is a draft unless input.Published is set.
	CreateReport(ctx context.Context, actor string, input NewReport) (*Report, error)
	// GetReport returns one report with every update, drafts included. A caller
	// serving the public must check Published.
	GetReport(ctx context.Context, id string) (*Report, error)
	// ListReports returns reports, each with its endpoints and latest update.
	ListReports(ctx context.Context, filter ReportFilter) ([]*Report, error)
	// ChangeReport edits the title or the affected endpoints.
	ChangeReport(ctx context.Context, actor, id string, change ReportChange) (*Report, error)
	// AddReportUpdate adds a dated update, which also sets the report's stage.
	AddReportUpdate(ctx context.Context, actor, id string, update NewReportUpdate) (*Report, error)
	// SetReportPublished publishes a report or returns it to draft.
	SetReportPublished(ctx context.Context, actor, id string, published bool) (*Report, error)
}

// Store saves records. Each update loads the record, applies the edit and saves
// the result in one transaction that excludes other writers of that record, so a
// rule the edit checks still holds when the write lands.
type Store interface {
	// CreateIncident saves an incident and its timeline, numbering the entries.
	CreateIncident(ctx context.Context, incident *Incident) error
	// Incident returns one incident with its timeline, or ErrNotFound.
	Incident(ctx context.Context, id string) (*Incident, error)
	// Incidents returns incidents without their timelines.
	Incidents(ctx context.Context, filter IncidentFilter) ([]*Incident, error)
	// UpdateIncident applies edit, which changes the incident and returns the
	// timeline entries to add. Returning no entries or an error saves nothing.
	UpdateIncident(ctx context.Context, id string, edit func(*Incident) ([]TimelineEntry, error)) (*Incident, error)

	// CreateReport saves a report, numbering its updates.
	CreateReport(ctx context.Context, report *Report) error
	// Report returns one report with every update, or ErrNotFound.
	Report(ctx context.Context, id string) (*Report, error)
	// Reports returns reports, each with its endpoints and latest update.
	Reports(ctx context.Context, filter ReportFilter) ([]*Report, error)
	// UpdateReport applies edit, which changes the report and appends any new
	// updates with Seq 0. Returning false or an error saves nothing.
	UpdateReport(ctx context.Context, id string, edit func(*Report) (bool, error)) (*Report, error)
}

// Event topics. Handlers run on the writer's goroutine, so slow work belongs on a
// job. Delivery is not durable: an event is lost if the process stops, so a
// subscriber that must not miss one should read the records as well. Payloads are
// shared between subscribers and must be treated as read-only.
const (
	// TopicIncidentCreated carries an IncidentEvent.
	TopicIncidentCreated = "incidents.incident.created"
	// TopicIncidentChanged carries an IncidentEvent, for any edited field.
	TopicIncidentChanged = "incidents.incident.changed"
	// TopicIncidentStateChanged carries an IncidentEvent.
	TopicIncidentStateChanged = "incidents.incident.state-changed"
	// TopicIncidentNoteAdded carries an IncidentEvent.
	TopicIncidentNoteAdded = "incidents.incident.note-added"

	// TopicReportCreated carries a ReportEvent, for drafts as well.
	TopicReportCreated = "incidents.report.created"
	// TopicReportChanged carries a ReportEvent, for a title or endpoint edit.
	TopicReportChanged = "incidents.report.changed"
	// TopicReportUpdateAdded carries a ReportEvent with Update set.
	TopicReportUpdateAdded = "incidents.report.update-added"
	// TopicReportPublished carries a ReportEvent, also when a report is created
	// published.
	TopicReportPublished = "incidents.report.published"
	// TopicReportUnpublished carries a ReportEvent.
	TopicReportUnpublished = "incidents.report.unpublished"
)

// ReportTopics lists every report topic.
var ReportTopics = []string{TopicReportCreated, TopicReportChanged, TopicReportUpdateAdded, TopicReportPublished, TopicReportUnpublished}

// IncidentEvent is the payload of every incident topic. Incidents are internal,
// so a subscriber must not pass one to the public.
type IncidentEvent struct {
	Actor    string
	Incident Incident
	// Entries are the timeline entries this change added.
	Entries []TimelineEntry
}

// ReportEvent is the payload of every report topic. Drafts raise events too, so a
// subscriber that tells the public must check Report.Published.
type ReportEvent struct {
	Actor  string
	Report Report
	// Update is the update this change added, if any.
	Update *ReportUpdate
}
