// Package record is the public face of the incidents plugin: its data types, its
// rules, the Service other plugins use, and the events it publishes.
//
// It holds two records that are kept apart on purpose. An Incident is internal:
// how the team runs the problem. A Report is public: what visitors are told.
// Changing one never changes the other, because what is true inside and what has
// been announced move at different speeds.
package record

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"time"
)

// Severity says how bad an incident is.
type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityMajor    Severity = "major"
	SeverityMinor    Severity = "minor"
)

// State is where an incident is in its life. See CanMove for the allowed moves.
type State string

const (
	StateOpen      State = "open"
	StateMitigated State = "mitigated"
	StateResolved  State = "resolved"
	StateCancelled State = "cancelled"
	// StateClosed is final and frozen: nothing about the incident can change.
	StateClosed State = "closed"
)

// Stage is how far a report has progressed, as told to the public.
type Stage string

const (
	StageInvestigating Stage = "investigating"
	StageIdentified    Stage = "identified"
	StageMonitoring    Stage = "monitoring"
	StageResolved      Stage = "resolved"
)

// Impact says how a report affects one endpoint.
type Impact string

const (
	ImpactMaintenance Impact = "maintenance"
	ImpactDegraded    Impact = "degraded"
	ImpactPartial     Impact = "partial"
	ImpactMajor       Impact = "major"
)

// EntryKind says what a timeline entry records.
type EntryKind string

const (
	EntryCreated    EntryKind = "created"
	EntryNote       EntryKind = "note"
	EntryState      EntryKind = "state"
	EntryTitle      EntryKind = "title"
	EntrySeverity   EntryKind = "severity"
	EntryCommander  EntryKind = "commander"
	EntryPostmortem EntryKind = "postmortem"
	EntryReportLink EntryKind = "report-link"
)

// TimelineEntry is one line of an incident's history. Entries are only added.
type TimelineEntry struct {
	// Seq orders entries within an incident, starting at 1.
	Seq   int       `json:"seq"`
	At    time.Time `json:"at"`
	Actor string    `json:"actor"`
	Kind  EntryKind `json:"kind"`
	// From and To hold the old and new value of a change.
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
	// Note is the text of an EntryNote.
	Note string `json:"note,omitempty"`
}

// Incident is the internal record of a problem.
type Incident struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Severity  Severity `json:"severity"`
	Commander string   `json:"commander,omitempty"`
	State     State    `json:"state"`
	// Postmortem is Markdown, and untrusted: render it only through a sanitiser.
	Postmortem string `json:"postmortem,omitempty"`
	// ReportID links to one Report. The link never moves either record.
	ReportID  string    `json:"report_id,omitempty"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// Timeline is filled by GetIncident and left empty by ListIncidents.
	Timeline []TimelineEntry `json:"timeline,omitempty"`
}

// AffectedEndpoint names one endpoint a report touches. Key is the endpoint's
// Gatus key. It is plain text because endpoints can later leave the configuration
// while the report stays true.
type AffectedEndpoint struct {
	Key    string `json:"key"`
	Impact Impact `json:"impact"`
}

// ReportUpdate is one dated step of a report.
type ReportUpdate struct {
	// Seq orders updates within a report, starting at 1.
	Seq     int       `json:"seq"`
	At      time.Time `json:"at"`
	Actor   string    `json:"actor"`
	Stage   Stage     `json:"stage"`
	Message string    `json:"message"`
}

// Report is the public record of a problem. A draft has a nil PublishedAt.
type Report struct {
	ID        string             `json:"id"`
	Title     string             `json:"title"`
	Stage     Stage              `json:"stage"`
	Endpoints []AffectedEndpoint `json:"endpoints"`
	// Updates is in order. ListReports returns only the latest one.
	Updates     []ReportUpdate `json:"updates"`
	PublishedAt *time.Time     `json:"published_at,omitempty"`
	ResolvedAt  *time.Time     `json:"resolved_at,omitempty"`
	CreatedBy   string         `json:"created_by"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

// Published reports whether the public may see the report.
func (r *Report) Published() bool { return r.PublishedAt != nil }

// LatestUpdate returns the newest update, or nil if the report has none.
func (r *Report) LatestUpdate() *ReportUpdate {
	if len(r.Updates) == 0 {
		return nil
	}
	return &r.Updates[len(r.Updates)-1]
}

// WorstImpact returns the most serious impact on any endpoint, or "" if the
// report names none.
func (r *Report) WorstImpact() Impact {
	var worst Impact
	for _, endpoint := range r.Endpoints {
		if impactRank[endpoint.Impact] > impactRank[worst] {
			worst = endpoint.Impact
		}
	}
	return worst
}

var impactRank = map[Impact]int{ImpactMaintenance: 1, ImpactDegraded: 2, ImpactPartial: 3, ImpactMajor: 4}

// NewID returns a random identifier, so an ID reveals nothing about how many
// records exist or in what order they were made.
func NewID() string {
	raw := make([]byte, 16)
	_, _ = rand.Read(raw) // crypto/rand.Read never returns an error
	return hex.EncodeToString(raw)
}

var idPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// ValidID reports whether id has the form NewID produces.
func ValidID(id string) bool { return idPattern.MatchString(id) }
