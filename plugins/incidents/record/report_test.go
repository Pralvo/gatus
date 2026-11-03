package record_test

import (
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"github.com/TwiN/gatus/v5/plugins/incidents/sqlstore"
)

func TestReportLifecycle(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		report := newReport(t, f, false)
		if report.Published() || report.WorstImpact() != record.ImpactMajor || report.Endpoints[0].Key != "core_db" {
			t.Fatalf("created: %+v", report)
		}
		if got := f.topics(); len(got) != 1 || got[0] != record.TopicReportCreated {
			t.Fatalf("a draft raised: %v", got)
		}
		stored, err := f.GetReport(ctx, report.ID)
		if err != nil || len(stored.Updates) != 1 || stored.Updates[0].Message != "Looking into it." || len(stored.Endpoints) != 2 {
			t.Fatalf("stored: %v %+v", err, stored)
		}
		if !stored.CreatedAt.Equal(report.CreatedAt) {
			t.Fatalf("time changed in storage: %s and %s", stored.CreatedAt, report.CreatedAt)
		}

		f.reset()
		published, err := f.SetReportPublished(ctx, "bob", report.ID, true)
		if err != nil || !published.Published() {
			t.Fatalf("publish: %v %+v", err, published)
		}
		if _, err := f.SetReportPublished(ctx, "bob", report.ID, true); err != nil {
			t.Fatal(err)
		}
		if got := f.topics(); len(got) != 1 || got[0] != record.TopicReportPublished {
			t.Fatalf("publishing twice raised: %v", got)
		}

		resolved, err := f.AddReportUpdate(ctx, "bob", report.ID, record.NewReportUpdate{Stage: record.StageResolved, Message: "Fixed."})
		if err != nil || resolved.Stage != record.StageResolved || resolved.ResolvedAt == nil || len(resolved.Updates) != 2 || resolved.Updates[1].Seq != 2 {
			t.Fatalf("resolve: %v %+v", err, resolved)
		}
		data := f.events[len(f.events)-1].data.(record.ReportEvent)
		if data.Update == nil || data.Update.Message != "Fixed." || data.Actor != "bob" {
			t.Fatalf("event: %+v", data)
		}
		reopened, err := f.AddReportUpdate(ctx, "bob", report.ID, record.NewReportUpdate{Stage: record.StageMonitoring, Message: "Back."})
		if err != nil || reopened.ResolvedAt != nil || reopened.LatestUpdate().Stage != record.StageMonitoring {
			t.Fatalf("reopen: %v %+v", err, reopened)
		}
		unpublished, err := f.SetReportPublished(ctx, "bob", report.ID, false)
		if err != nil || unpublished.Published() {
			t.Fatalf("unpublish: %v %+v", err, unpublished)
		}
	})
}

func TestCreatingPublishedRaisesBothEvents(t *testing.T) {
	f := newFixture(t, databasetest.SQLite(t))
	newReport(t, f, true)
	if got := f.topics(); !slices.Equal(got, []string{record.TopicReportCreated, record.TopicReportPublished}) {
		t.Fatalf("events: %v", got)
	}
}

func TestEndpointKeysAreCheckedOnWriteAndKeptAsText(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		_, err := f.CreateReport(ctx, "alice", record.NewReport{
			Title: "x", Stage: record.StageIdentified, Message: "y",
			Endpoints: []record.AffectedEndpoint{{Key: "core_gone", Impact: record.ImpactMajor}},
		})
		if !errors.Is(err, record.ErrUnknownEndpoint) || !strings.Contains(err.Error(), "core_gone") {
			t.Fatalf("unknown key: %v", err)
		}
		report := newReport(t, f, false)
		if _, err := f.ChangeReport(ctx, "bob", report.ID, record.ReportChange{Endpoints: []record.AffectedEndpoint{{Key: "core_gone", Impact: record.ImpactMajor}}}); !errors.Is(err, record.ErrUnknownEndpoint) {
			t.Fatalf("unknown key on edit: %v", err)
		}
		stored, _ := f.GetReport(ctx, report.ID)
		if len(stored.Endpoints) != 2 {
			t.Fatalf("a refused edit changed the list: %+v", stored.Endpoints)
		}
		// An endpoint that later leaves the configuration stays editable on the report.
		gone := record.NewManager(sqlstore.New(db), time.Now, func(string, any) {}, func(string) bool { return false })
		kept, err := gone.ChangeReport(ctx, "bob", report.ID, record.ReportChange{Title: ptr("Renamed"), Endpoints: []record.AffectedEndpoint{{Key: "core_db", Impact: record.ImpactPartial}}})
		if err != nil || len(kept.Endpoints) != 1 || kept.Endpoints[0].Impact != record.ImpactPartial {
			t.Fatalf("held key: %v %+v", err, kept)
		}
		cleared, err := f.ChangeReport(ctx, "bob", report.ID, record.ReportChange{Endpoints: []record.AffectedEndpoint{}})
		if err != nil || len(cleared.Endpoints) != 0 || cleared.WorstImpact() != "" {
			t.Fatalf("clear: %v %+v", err, cleared)
		}
	})
}

func TestValidationRefusesBadInput(t *testing.T) {
	f := newFixture(t, databasetest.SQLite(t))
	long := strings.Repeat("é", record.MaxTitleLength+1)
	endpoint := func(key string, impact record.Impact) []record.AffectedEndpoint {
		return []record.AffectedEndpoint{{Key: key, Impact: impact}}
	}
	report := func(mutate func(*record.NewReport)) error {
		input := record.NewReport{Title: "x", Stage: record.StageIdentified, Message: "y"}
		mutate(&input)
		_, err := f.CreateReport(ctx, "alice", input)
		return err
	}
	cases := map[string]error{
		"blank title":      report(func(r *record.NewReport) { r.Title = "   " }),
		"long title":       report(func(r *record.NewReport) { r.Title = long }),
		"newline in title": report(func(r *record.NewReport) { r.Title = "a\nb" }),
		"nul in message":   report(func(r *record.NewReport) { r.Message = "a\x00b" }),
		"invalid text":     report(func(r *record.NewReport) { r.Message = "a\xffb" }),
		"blank message":    report(func(r *record.NewReport) { r.Message = "\n" }),
		"long message":     report(func(r *record.NewReport) { r.Message = strings.Repeat("a", record.MaxTextLength+1) }),
		"unknown stage":    report(func(r *record.NewReport) { r.Stage = "panicking" }),
		"unknown impact":   report(func(r *record.NewReport) { r.Endpoints = endpoint("core_db", "total") }),
		"repeated key": report(func(r *record.NewReport) {
			r.Endpoints = append(endpoint("core_db", record.ImpactMajor), endpoint("core_db", record.ImpactPartial)...)
		}),
		"too many keys": report(func(r *record.NewReport) {
			r.Endpoints = make([]record.AffectedEndpoint, record.MaxEndpoints+1)
		}),
	}
	_, cases["bad severity"] = f.CreateIncident(ctx, "alice", record.NewIncident{Title: "x", Severity: "huge"})
	_, cases["no actor"] = f.CreateIncident(ctx, " ", record.NewIncident{Title: "x", Severity: record.SeverityMinor})
	_, cases["no report"] = f.CreateIncident(ctx, "alice", record.NewIncident{Title: "x", Severity: record.SeverityMinor, ReportID: record.NewID()})
	_, cases["malformed report id"] = f.CreateIncident(ctx, "alice", record.NewIncident{Title: "x", Severity: record.SeverityMinor, ReportID: "../x"})
	_, cases["bad filter"] = f.ListIncidents(ctx, record.IncidentFilter{State: "paused"})
	_, cases["negative limit"] = f.ListReports(ctx, record.ReportFilter{Limit: -1})
	for name, err := range cases {
		if !errors.Is(err, record.ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := f.GetIncident(ctx, "' OR 1=1 --"); !errors.Is(err, record.ErrNotFound) {
		t.Errorf("malformed id: %v", err)
	}
	if _, err := f.GetReport(ctx, record.NewID()); !errors.Is(err, record.ErrNotFound) {
		t.Errorf("missing report: %v", err)
	}
}

func TestHostileTextIsStoredExactly(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		hostile := `'; DROP TABLE incident_records; -- <script>alert("?")</script> $1 ?`
		incident, err := f.CreateIncident(ctx, "alice", record.NewIncident{Title: hostile, Severity: record.SeverityMinor})
		if err != nil {
			t.Fatal(err)
		}
		stored, err := f.GetIncident(ctx, incident.ID)
		if err != nil || stored.Title != hostile {
			t.Fatalf("stored: %v %+v", err, stored)
		}
	})
}

func TestListsFilterOrderAndBound(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		f := newFixture(t, db)
		first, second := openIncident(t, f), openIncident(t, f)
		if _, err := f.SetIncidentState(ctx, "bob", first.ID, record.StateMitigated); err != nil {
			t.Fatal(err)
		}
		all, err := f.ListIncidents(ctx, record.IncidentFilter{})
		if err != nil || len(all) != 2 || all[0].ID != second.ID || all[0].Timeline != nil {
			t.Fatalf("list: %v %+v", err, all)
		}
		mitigated, err := f.ListIncidents(ctx, record.IncidentFilter{State: record.StateMitigated})
		if err != nil || len(mitigated) != 1 || mitigated[0].ID != first.ID {
			t.Fatalf("filter: %v %+v", err, mitigated)
		}
		page, err := f.ListIncidents(ctx, record.IncidentFilter{Limit: 1, Offset: 1})
		if err != nil || len(page) != 1 || page[0].ID != first.ID {
			t.Fatalf("window: %v %+v", err, page)
		}

		draft := newReport(t, f, false)
		live := newReport(t, f, true)
		old := newReport(t, f, true)
		if _, err := f.AddReportUpdate(ctx, "bob", old.ID, record.NewReportUpdate{Stage: record.StageResolved, Message: "Done."}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.AddReportUpdate(ctx, "bob", live.ID, record.NewReportUpdate{Stage: record.StageMonitoring, Message: "Watching."}); err != nil {
			t.Fatal(err)
		}
		public, err := f.ListReports(ctx, record.ReportFilter{PublishedOnly: true})
		if err != nil || len(public) != 2 || public[0].ID != live.ID || public[1].ID != old.ID {
			t.Fatalf("unresolved must come first and drafts stay out: %v %+v", err, public)
		}
		if len(public[0].Updates) != 1 || public[0].Updates[0].Message != "Watching." || len(public[0].Endpoints) != 2 {
			t.Fatalf("list must carry the latest update and endpoints: %+v", public[0])
		}
		recent, err := f.ListReports(ctx, record.ReportFilter{PublishedOnly: true, ResolvedSince: time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)})
		if err != nil || len(recent) != 1 || recent[0].ID != live.ID {
			t.Fatalf("resolved cut-off: %v %+v", err, recent)
		}
		staged, err := f.ListReports(ctx, record.ReportFilter{Stage: record.StageInvestigating})
		if err != nil || len(staged) != 1 || staged[0].ID != draft.ID {
			t.Fatalf("stage filter: %v %+v", err, staged)
		}
	})
}
