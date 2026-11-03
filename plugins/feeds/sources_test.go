package feeds

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/config/suite"
	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/notice"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"github.com/TwiN/gatus/v5/plugins/maintenancewindows"
	"github.com/TwiN/gatus/v5/storage/store"
	"gopkg.in/yaml.v3"
)

const reportID = "0123456789abcdef0123456789abcdef"

var day1 = time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)

// fakeReports is a record.Service that only lists. Any other method panics.
type fakeReports struct {
	record.Service
	mu      sync.Mutex
	reports []*record.Report
	err     error
	filters []record.ReportFilter
}

func (f *fakeReports) ListReports(ctx context.Context, filter record.ReportFilter) ([]*record.Report, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.filters = append(f.filters, filter)
	if _, ok := ctx.Deadline(); !ok {
		return nil, errors.New("read has no deadline")
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.reports[:min(filter.Limit, len(f.reports))], nil
}

func (f *fakeReports) set(reports []*record.Report, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reports, f.err = reports, err
}

func provide(service record.Service) plugin.Definition {
	return plugin.Definition{
		Name:     "incidents",
		Provides: []plugin.Key{incidentsKey},
		Start:    func(ctx *plugin.Context) error { ctx.Provide(incidentsKey, service); return nil },
	}
}

func report(id, title string, stage record.Stage, at time.Time) *record.Report {
	published := at
	r := &record.Report{ID: id, Title: title, Stage: stage, PublishedAt: &published, CreatedAt: at, UpdatedAt: at,
		Updates: []record.ReportUpdate{{Seq: 1, At: at, Stage: stage, Message: "Latest words."}}}
	if stage == record.StageResolved {
		r.ResolvedAt = &at
	}
	return r
}

// withCache sets how long entries are reused, for one test.
func withCache(t *testing.T, d time.Duration) {
	before := cacheFor
	cacheFor = d
	t.Cleanup(func() { cacheFor = before })
}

func TestReportsKeepOneEntryWithAStableID(t *testing.T) {
	withCache(t, 0)
	reports := &fakeReports{reports: []*record.Report{report(reportID, "Slow reads", record.StageIdentified, day1)}}
	// The incidents plugin's notice for the same report must not repeat it.
	defer notice.AddNamedSource(incidentsNotices, func() []*announcement.Announcement {
		return []*announcement.Announcement{note(1, "warning", "**Identified: Slow reads**\n\n[Read the report](/reports/"+reportID+")")}
	})()
	h := plugintest.Start(t, Definition, validConfig, core(note(2, "none", "Configured")), provide(reports))
	first := readAll(t, getter(h))
	want := "tag:status.example.com,2026-11-01:report:" + reportID
	for format, items := range first {
		if len(items) != 2 || items[1].id != want || items[1].title != "Identified: Slow reads" || items[1].link != "https://status.example.com/reports/"+reportID {
			t.Fatalf("format %d: %+v", format, items)
		}
	}
	edited := report(reportID, "Slow reads on the primary", record.StageResolved, day1)
	edited.UpdatedAt = day1.Add(26 * time.Hour)
	edited.Updates = append(edited.Updates, record.ReportUpdate{Seq: 2, At: day1.Add(25 * time.Hour), Stage: record.StageResolved, Message: "Fixed."})
	reports.set([]*record.Report{edited}, nil)
	for format, items := range readAll(t, getter(h)) {
		if len(items) != 2 || items[0].id != want || items[0].title != "Resolved: Slow reads on the primary" || items[0].content != "Fixed." {
			t.Fatalf("format %d after the edit: %+v", format, items)
		}
	}
	atom := readAll(t, getter(h))[0]
	if atom[0].updated != "2026-11-02T12:00:00Z" {
		t.Fatalf("updated is not the latest change: %s", atom[0].updated)
	}
}

func TestResolvedReportsStayUntilTheLimitPushesThemOut(t *testing.T) {
	withCache(t, 0)
	old := report(reportID, "Long ago", record.StageResolved, time.Now().Add(-90*24*time.Hour))
	draft := report("fedcba9876543210fedcba9876543210", "Draft", record.StageInvestigating, time.Now())
	draft.PublishedAt = nil
	reports := &fakeReports{reports: []*record.Report{draft, old}}
	h := plugintest.Start(t, Definition, validConfig+"\nlimit: 7", core(), provide(reports))
	for format, items := range readAll(t, getter(h)) {
		if len(items) != 1 || items[0].title != "Resolved: Long ago" {
			t.Fatalf("format %d: %+v", format, items)
		}
	}
	filter := reports.filters[0]
	if !filter.PublishedOnly || !filter.ResolvedSince.IsZero() || filter.Limit != 7 {
		t.Fatalf("filter: %+v", filter)
	}
}

func TestAFailedReadServesTheLastGoodReports(t *testing.T) {
	withCache(t, 0)
	reports := &fakeReports{reports: []*record.Report{report(reportID, "Slow reads", record.StageIdentified, day1)}}
	h := plugintest.Start(t, Definition, validConfig, core(), provide(reports))
	readAll(t, getter(h))
	reports.set(nil, errors.New("database is down"))
	for format, items := range readAll(t, getter(h)) {
		if len(items) != 1 {
			t.Fatalf("format %d dropped the report while the database was down: %+v", format, items)
		}
	}
}

func clearStore(t *testing.T) {
	store.Get().Clear()
	t.Cleanup(store.Get().Clear)
}

func check(t *testing.T, ep *endpoint.Endpoint, success bool, at time.Time) {
	t.Helper()
	result := &endpoint.Result{Success: success, Timestamp: at, Hostname: "secret-host", Errors: []string{"secret error"}}
	if err := store.Get().InsertEndpointResult(ep, result); err != nil {
		t.Fatal(err)
	}
}

func TestStatusChangesNameOnlyWhatThePageShows(t *testing.T) {
	withCache(t, 0)
	clearStore(t)
	website := &endpoint.Endpoint{Group: "core", Name: "Website", URL: "https://secret.example.com/token"}
	check(t, website, true, day1)
	check(t, website, false, day1.Add(time.Minute))
	check(t, website, false, day1.Add(2*time.Minute))
	check(t, website, true, day1.Add(3*time.Minute))
	// An endpoint that runs only inside a suite is not on the page.
	hidden := &endpoint.Endpoint{Name: "Hidden step"}
	if err := store.Get().InsertSuiteResult(&suite.Suite{Name: "flow", Endpoints: []*endpoint.Endpoint{hidden}},
		&suite.Result{Name: "flow", Timestamp: day1, EndpointResults: []*endpoint.Result{{Name: "Hidden step", Timestamp: day1}}}); err != nil {
		t.Fatal(err)
	}
	h := plugintest.Start(t, Definition, validConfig+"\nstatus-changes: true", core())
	for format, items := range readAll(t, getter(h)) {
		if len(items) != 2 || items[0].title != "Website is working again" || items[1].title != "Website is down" {
			t.Fatalf("format %d: %+v", format, items)
		}
		if items[0].link != "https://status.example.com/endpoints/core_website" {
			t.Fatalf("format %d links %s", format, items[0].link)
		}
	}
	for _, path := range []string{"/feed/atom.xml", "/feed/rss.xml", "/feed/feed.json"} {
		if body := h.Get(path).Body.String(); strings.Contains(body, "secret") || strings.Contains(body, "Hidden") {
			t.Fatalf("%s published what the page hides:\n%s", path, body)
		}
	}
	off := plugintest.Start(t, Definition, validConfig, core())
	if items := readAll(t, getter(off))[0]; len(items) != 0 {
		t.Fatalf("status changes appeared without being asked for: %+v", items)
	}
}

// hostGetter reads from a host the way the router does.
func hostGetter(h *plugin.Host) func(path string) (int, string) {
	return func(path string) (int, string) {
		handler := h.Match(http.MethodGet, path)
		if handler == nil {
			return http.StatusNotFound, ""
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder.Code, recorder.Body.String()
	}
}

func entryOf(t *testing.T, name, configYAML string) *plugin.Entry {
	t.Helper()
	entry := &plugin.Entry{Name: name}
	if configYAML != "" {
		var document yaml.Node
		if err := yaml.Unmarshal([]byte(configYAML), &document); err != nil {
			t.Fatal(err)
		}
		entry.Config = *document.Content[0]
	}
	return entry
}

func active(t *testing.T, statuses []plugin.Status) {
	t.Helper()
	for _, status := range statuses {
		if status.State != plugin.StateActive {
			t.Fatalf("%s is %s: %s", status.Name, status.State, status.Reason)
		}
	}
}

// titlesOf lists each format's titles, and whether the formats agree.
func titlesOf(t *testing.T, get func(path string) (int, string)) ([]string, bool) {
	t.Helper()
	var out []string
	for format, items := range readAll(t, get) {
		var got []string
		for _, i := range items {
			got = append(got, i.title)
		}
		if format == 0 {
			out = got
		} else if strings.Join(got, "\n") != strings.Join(out, "\n") {
			return out, false
		}
	}
	return out, true
}

// titles is titlesOf for a feed that is not changing, so the formats must agree.
func titles(t *testing.T, get func(path string) (int, string)) []string {
	t.Helper()
	out, agree := titlesOf(t, get)
	if !agree {
		t.Fatalf("the formats disagree; atom shows %q", out)
	}
	return out
}

func TestReportWritesReachEveryFeedAtOnce(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		var service record.Service
		registry := plugin.NewRegistry()
		registry.Add(Definition)
		registry.Add(incidents.Definition)
		registry.Add(plugin.Definition{Name: "database", Provides: []plugin.Key{database.Key},
			Start: func(ctx *plugin.Context) error { ctx.Provide(database.Key, db); return nil }})
		registry.Add(plugin.Definition{Name: "writer", Needs: []plugin.Key{incidentsKey},
			Start: func(ctx *plugin.Context) error { service = plugin.Get[record.Service](ctx, incidentsKey); return nil }})
		host := plugin.NewHost(registry)
		host.SetCore(plugin.CoreConfig, &config.Config{UI: ui.GetDefaultConfig()})
		t.Cleanup(host.Shutdown)
		active(t, host.Reconcile([]*plugin.Entry{entryOf(t, "database", ""), entryOf(t, "incidents", ""), entryOf(t, "writer", ""), entryOf(t, "feeds", validConfig)}))
		get := hostGetter(host)
		if got := titles(t, get); len(got) != 0 {
			t.Fatalf("before: %q", got)
		}
		ctx := context.Background()
		created, err := service.CreateReport(ctx, "test", record.NewReport{Title: "Slow reads", Stage: record.StageInvestigating, Message: "Looking.", Published: true})
		if err != nil {
			t.Fatal(err)
		}
		// The entries are reused for ten seconds, so these show the change cleared them.
		if got := titles(t, get); len(got) != 1 || got[0] != "Investigating: Slow reads" {
			t.Fatalf("after the write: %q", got)
		}
		id := readAll(t, get)[0][0].id
		title := "Slow reads on the primary"
		if _, err := service.ChangeReport(ctx, "test", created.ID, record.ReportChange{Title: &title}); err != nil {
			t.Fatal(err)
		}
		if _, err := service.AddReportUpdate(ctx, "test", created.ID, record.NewReportUpdate{Stage: record.StageResolved, Message: "Fixed."}); err != nil {
			t.Fatal(err)
		}
		for format, items := range readAll(t, get) {
			if len(items) != 1 || items[0].id != id || items[0].title != "Resolved: "+title || items[0].content != "Fixed." {
				t.Fatalf("format %d after the edits: %+v", format, items)
			}
		}
	})
}

// eventually polls until want holds, for changes that take a refresh to show.
func eventually(t *testing.T, get func(path string) (int, string), want func([]string) bool) []string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		// A refresh can land between the three reads, so wait for them to agree.
		got, agree := titlesOf(t, get)
		if agree && want(got) {
			return got
		}
		if time.Now().After(deadline) {
			t.Fatalf("feeds never changed: %q", got)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestMaintenanceAndStatusChangesReachEveryFeedWithoutARestart(t *testing.T) {
	withCache(t, 50*time.Millisecond)
	clearStore(t)
	website := &endpoint.Endpoint{Group: "core", Name: "Website"}
	registry := plugin.NewRegistry()
	registry.Add(Definition)
	registry.Add(maintenancewindows.Definition)
	host := plugin.NewHost(registry)
	host.SetCore(plugin.CoreConfig, &config.Config{UI: ui.GetDefaultConfig(), Endpoints: []*endpoint.Endpoint{website}})
	t.Cleanup(host.Shutdown)
	feeds := entryOf(t, "feeds", validConfig+"\nstatus-changes: true")
	active(t, host.Reconcile([]*plugin.Entry{feeds, entryOf(t, "maintenance-windows", "windows: []")}))
	get := hostGetter(host)
	if got := titles(t, get); len(got) != 0 {
		t.Fatalf("before: %q", got)
	}
	start := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	end := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	window := "windows:\n  - title: Database upgrade\n    start: " + start + "\n    end: " + end + "\n    announce-before: 24h"
	active(t, host.Reconcile([]*plugin.Entry{feeds, entryOf(t, "maintenance-windows", window)}))
	eventually(t, get, func(got []string) bool {
		return len(got) == 1 && got[0] == "Information: Scheduled maintenance: Database upgrade"
	})
	now := time.Now()
	check(t, website, true, now.Add(-2*time.Second))
	check(t, website, false, now.Add(-time.Second))
	got := eventually(t, get, func(got []string) bool { return len(got) == 2 })
	sort.Strings(got)
	if got[0] != "Information: Scheduled maintenance: Database upgrade" || got[1] != "Website is down" {
		t.Fatalf("got %q", got)
	}
}

// guardBlock finds the documented endpoint that watches the feed.
var guardBlock = regexp.MustCompile("(?s)```yaml\n(endpoints:\n.*?/feed/feed.json.*?)```")

func TestTheDocumentedGuardCatchesABrokenFeed(t *testing.T) {
	docs, err := os.ReadFile("../../docs/plugins.md")
	if err != nil {
		t.Fatal(err)
	}
	match := guardBlock.FindSubmatch(docs)
	if match == nil {
		t.Fatal("docs/plugins.md has no endpoint that watches /feed/feed.json")
	}
	var guard struct {
		Endpoints []*endpoint.Endpoint `yaml:"endpoints"`
	}
	if err := yaml.Unmarshal(match[1], &guard); err != nil || len(guard.Endpoints) != 1 {
		t.Fatalf("the documented guard does not parse: %v", err)
	}
	h := plugintest.Start(t, Definition, validConfig, core(note(1, "none", "Configured")))
	cases := map[string]struct {
		serve func(w http.ResponseWriter, r *http.Request)
		pass  bool
	}{
		"the real feed": {func(w http.ResponseWriter, r *http.Request) { h.Host.Match(r.Method, r.URL.Path).ServeHTTP(w, r) }, true},
		"an error":      {func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "feed unavailable", 500) }, false},
		"an error page": {func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("<html>oops</html>")) }, false},
		"an old version": {func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"version":"https://jsonfeed.org/version/1","title":"x","items":[]}`))
		}, false},
		"no title": {func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"version":"https://jsonfeed.org/version/1.1","items":[]}`))
		}, false},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(c.serve))
			defer server.Close()
			ep := *guard.Endpoints[0]
			ep.URL = server.URL + "/feed/feed.json"
			if err := ep.ValidateAndSetDefaults(); err != nil {
				t.Fatal(err)
			}
			if result := ep.EvaluateHealth(); result.Success != c.pass {
				t.Fatalf("success %t, want %t: %+v", result.Success, c.pass, result.ConditionResults)
			}
		})
	}
}
