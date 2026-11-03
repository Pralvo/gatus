package record_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"github.com/TwiN/gatus/v5/plugins/incidents/sqlstore"
)

type event struct {
	topic string
	data  any
}

type fixture struct {
	*record.Manager
	mu     sync.Mutex
	events []event
	moment time.Time
}

func (f *fixture) topics() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	topics := make([]string, 0, len(f.events))
	for _, e := range f.events {
		topics = append(topics, e.topic)
	}
	return topics
}

func (f *fixture) reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = nil
}

func newFixture(t *testing.T, db *database.DB) *fixture {
	t.Helper()
	store := sqlstore.New(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	f := &fixture{moment: time.Date(2026, 11, 3, 10, 0, 0, 123_456_789, time.FixedZone("elsewhere", 3600))}
	now := func() time.Time {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.moment = f.moment.Add(time.Second)
		return f.moment
	}
	publish := func(topic string, data any) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.events = append(f.events, event{topic, data})
	}
	known := func(key string) bool { return key == "core_db" || key == "core_web" }
	f.Manager = record.NewManager(store, now, publish, known)
	return f
}

var ctx = context.Background()

func openIncident(t *testing.T, f *fixture) *record.Incident {
	t.Helper()
	incident, err := f.CreateIncident(ctx, "alice", record.NewIncident{Title: "Database down", Severity: record.SeverityMajor})
	if err != nil {
		t.Fatal(err)
	}
	return incident
}

func newReport(t *testing.T, f *fixture, published bool) *record.Report {
	t.Helper()
	report, err := f.CreateReport(ctx, "alice", record.NewReport{
		Title: "Slow reads", Stage: record.StageInvestigating, Message: "Looking into it.", Published: published,
		Endpoints: []record.AffectedEndpoint{{Key: "core_web", Impact: record.ImpactDegraded}, {Key: "core_db", Impact: record.ImpactMajor}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return report
}

func ptr[T any](value T) *T { return &value }

func TestIncidentLifecycleIsRecordedInOrder(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		incident := openIncident(t, f)
		if !record.ValidID(incident.ID) || incident.State != record.StateOpen || incident.CreatedAt.Location() != time.UTC {
			t.Fatalf("created: %+v", incident)
		}
		for _, state := range []record.State{record.StateMitigated, record.StateOpen, record.StateResolved, record.StateOpen, record.StateCancelled, record.StateClosed} {
			if incident, _ = f.SetIncidentState(ctx, "bob", incident.ID, state); incident == nil || incident.State != state {
				t.Fatalf("moving to %s: %+v", state, incident)
			}
		}
		stored, err := f.GetIncident(ctx, incident.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(stored.Timeline) != 7 {
			t.Fatalf("timeline: %+v", stored.Timeline)
		}
		for i, entry := range stored.Timeline {
			if entry.Seq != i+1 {
				t.Fatalf("entry %d has seq %d", i, entry.Seq)
			}
			if i > 0 && !entry.At.After(stored.Timeline[i-1].At) {
				t.Fatalf("entry %d is out of time order", i)
			}
		}
		last := stored.Timeline[6]
		if last.Actor != "bob" || last.Kind != record.EntryState || last.From != "cancelled" || last.To != "closed" {
			t.Fatalf("last entry: %+v", last)
		}
	})
}

func TestInvalidTransitionsFailByName(t *testing.T) {
	cases := []struct {
		path []record.State
		to   record.State
	}{
		{nil, record.StateClosed},
		{nil, record.StateOpen},
		{[]record.State{record.StateMitigated}, record.StateClosed},
		{[]record.State{record.StateMitigated}, record.StateMitigated},
		{[]record.State{record.StateResolved}, record.StateMitigated},
		{[]record.State{record.StateResolved}, record.StateCancelled},
		{[]record.State{record.StateCancelled}, record.StateResolved},
	}
	f := newFixture(t, databasetest.SQLite(t))
	for _, c := range cases {
		incident := openIncident(t, f)
		for _, state := range c.path {
			if _, err := f.SetIncidentState(ctx, "bob", incident.ID, state); err != nil {
				t.Fatal(err)
			}
		}
		before, _ := f.GetIncident(ctx, incident.ID)
		f.reset()
		_, err := f.SetIncidentState(ctx, "bob", incident.ID, c.to)
		if !errors.Is(err, record.ErrInvalidTransition) || !strings.Contains(err.Error(), string(c.to)) {
			t.Fatalf("%v to %s: %v", c.path, c.to, err)
		}
		after, _ := f.GetIncident(ctx, incident.ID)
		if after.State != before.State || len(after.Timeline) != len(before.Timeline) || len(f.topics()) != 0 {
			t.Fatalf("a refused move changed something: %+v", after)
		}
	}
	if _, err := f.SetIncidentState(ctx, "bob", openIncident(t, f).ID, "paused"); !errors.Is(err, record.ErrInvalid) {
		t.Fatalf("unknown state: %v", err)
	}
}

func TestClosedIncidentIsFrozen(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		incident := openIncident(t, f)
		for _, state := range []record.State{record.StateResolved, record.StateClosed} {
			if _, err := f.SetIncidentState(ctx, "bob", incident.ID, state); err != nil {
				t.Fatal(err)
			}
		}
		before, _ := f.GetIncident(ctx, incident.ID)
		writes := map[string]func() error{
			"reopen": func() error { _, err := f.SetIncidentState(ctx, "bob", incident.ID, record.StateOpen); return err },
			"note":   func() error { _, err := f.AddIncidentNote(ctx, "bob", incident.ID, "late"); return err },
			"title": func() error {
				_, err := f.ChangeIncident(ctx, "bob", incident.ID, record.IncidentChange{Title: ptr("new")})
				return err
			},
			"postmortem": func() error {
				_, err := f.ChangeIncident(ctx, "bob", incident.ID, record.IncidentChange{Postmortem: ptr("late")})
				return err
			},
		}
		for name, write := range writes {
			if err := write(); !errors.Is(err, record.ErrFrozen) {
				t.Fatalf("%s: %v", name, err)
			}
		}
		after, _ := f.GetIncident(ctx, incident.ID)
		if after.Title != before.Title || after.Postmortem != "" || len(after.Timeline) != len(before.Timeline) || !after.UpdatedAt.Equal(before.UpdatedAt) {
			t.Fatalf("a frozen incident changed: %+v", after)
		}
	})
}

func TestEveryChangeReachesTheTimeline(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		incident := openIncident(t, f)
		report := newReport(t, f, false)
		f.reset()
		incident, err := f.ChangeIncident(ctx, "bob", incident.ID, record.IncidentChange{
			Title: ptr("Primary down"), Severity: ptr(record.SeverityCritical), Commander: ptr("carol"),
			Postmortem: ptr("# Cause\n\nA full disk."), ReportID: ptr(report.ID),
		})
		if err != nil {
			t.Fatal(err)
		}
		var kinds []record.EntryKind
		for _, entry := range incident.Timeline[1:] {
			kinds = append(kinds, entry.Kind)
			if entry.Actor != "bob" {
				t.Fatalf("actor: %+v", entry)
			}
		}
		for _, kind := range []record.EntryKind{record.EntryTitle, record.EntrySeverity, record.EntryCommander, record.EntryPostmortem, record.EntryReportLink} {
			if !slices.Contains(kinds, kind) {
				t.Fatalf("no %s entry in %v", kind, kinds)
			}
		}
		if incident.Commander != "carol" || incident.ReportID != report.ID || incident.Severity != record.SeverityCritical {
			t.Fatalf("incident: %+v", incident)
		}
		if got := f.topics(); len(got) != 1 || got[0] != record.TopicIncidentChanged {
			t.Fatalf("events: %v", got)
		}
		// Clearing works, and repeating a value is not a change.
		f.reset()
		same, err := f.ChangeIncident(ctx, "bob", incident.ID, record.IncidentChange{Title: ptr("Primary down")})
		if err != nil || len(same.Timeline) != len(incident.Timeline) || len(f.topics()) != 0 {
			t.Fatalf("a repeat recorded a change: %v %+v", err, same)
		}
		cleared, err := f.ChangeIncident(ctx, "bob", incident.ID, record.IncidentChange{Commander: ptr(""), ReportID: ptr("")})
		if err != nil || cleared.Commander != "" || cleared.ReportID != "" {
			t.Fatalf("clear: %v %+v", err, cleared)
		}
		noted, err := f.AddIncidentNote(ctx, "dan", incident.ID, "Line one\nLine two")
		if err != nil {
			t.Fatal(err)
		}
		last := noted.Timeline[len(noted.Timeline)-1]
		if last.Kind != record.EntryNote || last.Note != "Line one\nLine two" || last.Actor != "dan" {
			t.Fatalf("note: %+v", last)
		}
	})
}

func TestRecordsNeverMoveEachOther(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		report := newReport(t, f, true)
		incident, err := f.CreateIncident(ctx, "alice", record.NewIncident{Title: "Down", Severity: record.SeverityMinor, ReportID: report.ID})
		if err != nil {
			t.Fatal(err)
		}
		before, _ := f.GetReport(ctx, report.ID)
		if _, err := f.SetIncidentState(ctx, "bob", incident.ID, record.StateResolved); err != nil {
			t.Fatal(err)
		}
		after, _ := f.GetReport(ctx, report.ID)
		if after.Stage != before.Stage || !after.UpdatedAt.Equal(before.UpdatedAt) || len(after.Updates) != 1 {
			t.Fatalf("the incident moved the report: %+v", after)
		}
		incidentBefore, _ := f.GetIncident(ctx, incident.ID)
		if _, err := f.AddReportUpdate(ctx, "bob", report.ID, record.NewReportUpdate{Stage: record.StageResolved, Message: "Fixed."}); err != nil {
			t.Fatal(err)
		}
		incidentAfter, _ := f.GetIncident(ctx, incident.ID)
		if incidentAfter.State != incidentBefore.State || len(incidentAfter.Timeline) != len(incidentBefore.Timeline) {
			t.Fatalf("the report moved the incident: %+v", incidentAfter)
		}
	})
}

func TestConcurrentWritersKeepTheTimelineWhole(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		incident := openIncident(t, f)
		var wg sync.WaitGroup
		failures := make(chan error, 16)
		for range cap(failures) {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := f.AddIncidentNote(ctx, "bob", incident.ID, "note"); err != nil {
					failures <- err
				}
			}()
		}
		wg.Wait()
		close(failures)
		for err := range failures {
			t.Fatal(err)
		}
		stored, _ := f.GetIncident(ctx, incident.ID)
		if len(stored.Timeline) != 1+cap(failures) {
			t.Fatalf("timeline has %d entries", len(stored.Timeline))
		}
	})
}

func TestNothingLandsAfterClosingEvenInARace(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		for range 10 {
			incident := openIncident(t, f)
			if _, err := f.SetIncidentState(ctx, "bob", incident.ID, record.StateResolved); err != nil {
				t.Fatal(err)
			}
			var wg sync.WaitGroup
			wg.Add(2)
			go func() {
				defer wg.Done()
				if _, err := f.SetIncidentState(ctx, "bob", incident.ID, record.StateClosed); err != nil {
					t.Errorf("close: %v", err)
				}
			}()
			go func() {
				defer wg.Done()
				if _, err := f.AddIncidentNote(ctx, "bob", incident.ID, "racing"); err != nil && !errors.Is(err, record.ErrFrozen) {
					t.Errorf("note: %v", err)
				}
			}()
			wg.Wait()
			stored, err := f.GetIncident(ctx, incident.ID)
			if err != nil {
				t.Fatal(err)
			}
			if last := stored.Timeline[len(stored.Timeline)-1]; last.To != string(record.StateClosed) {
				t.Fatalf("an entry landed after closing: %+v", stored.Timeline)
			}
		}
	})
}

func TestDatabaseFailureIsNotDressedAsADomainError(t *testing.T) {
	db := databasetest.SQLite(t)
	f := newFixture(t, db)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	_, err := f.CreateIncident(ctx, "alice", record.NewIncident{Title: "x", Severity: record.SeverityMinor})
	if err == nil || errors.Is(err, record.ErrInvalid) || errors.Is(err, record.ErrNotFound) {
		t.Fatalf("error: %v", err)
	}
	if got := f.topics(); len(got) != 0 {
		t.Fatalf("a failed write raised %v", got)
	}
}
