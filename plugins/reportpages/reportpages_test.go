package reportpages

import (
	"compress/gzip"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/api"
	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"gopkg.in/yaml.v3"
)

// withIncidents runs the pages beside the real incidents plugin on db, and
// returns the service so the test can write reports.
func withIncidents(t *testing.T, db *database.DB) (*plugintest.Harness, record.Service) {
	t.Helper()
	var service record.Service
	dbProvider := plugin.Definition{
		Name:     "database",
		Provides: []plugin.Key{database.Key},
		Start:    func(ctx *plugin.Context) error { ctx.Provide(database.Key, db); return nil },
	}
	writer := plugin.Definition{
		Name:  "writer",
		Needs: []plugin.Key{incidentsKey},
		Start: func(ctx *plugin.Context) error { service = plugin.Get[record.Service](ctx, incidentsKey); return nil },
	}
	h := plugintest.Start(t, Definition, "", core(), dbProvider, incidents.Definition, writer)
	return h, service
}

func TestPagesReadTheRealStore(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		h, service := withIncidents(t, db)
		ctx := t.Context()
		shown, err := service.CreateReport(ctx, "alice", record.NewReport{
			Title: "Writes <b>failing</b>", Stage: record.StageInvestigating, Message: "We are looking.", Published: true,
			Endpoints: []record.AffectedEndpoint{{Key: "core_database", Impact: record.ImpactMajor}},
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.AddReportUpdate(ctx, "alice", shown.ID, record.NewReportUpdate{Stage: record.StageIdentified, Message: "Found it."}); err != nil {
			t.Fatal(err)
		}
		draft, err := service.CreateReport(ctx, "alice", record.NewReport{Title: "Not yet", Stage: record.StageInvestigating, Message: "Hidden."})
		if err != nil {
			t.Fatal(err)
		}

		list := h.Get("/reports").Body.String()
		if !strings.Contains(list, "Writes &lt;b&gt;failing&lt;/b&gt;") || !strings.Contains(list, "Found it.") || strings.Contains(list, "Not yet") {
			t.Fatalf("list:\n%s", list)
		}
		page := h.Get("/reports/" + shown.ID)
		body := page.Body.String()
		if page.Code != http.StatusOK || !strings.Contains(body, "core/database") || !strings.Contains(body, "Major outage") ||
			strings.Index(body, "Found it.") > strings.Index(body, "We are looking.") {
			t.Fatalf("report %d:\n%s", page.Code, body)
		}
		if code := h.Get("/reports/" + draft.ID).Code; code != http.StatusNotFound {
			t.Fatalf("draft: %d", code)
		}

		// The database goes away under a running plugin.
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"/reports", "/reports/" + shown.ID} {
			if response := h.Get(path); response.Code != http.StatusServiceUnavailable {
				t.Fatalf("%s with the database closed: %d", path, response.Code)
			}
		}
	})
}

func entry(t *testing.T, name, configYAML string) *plugin.Entry {
	t.Helper()
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(configYAML), &document); err != nil {
		t.Fatal(err)
	}
	return &plugin.Entry{Name: name, Config: *document.Content[0]}
}

// serve runs the plugins in the real host behind the real router and a socket,
// the way the gatus binary does.
func serve(t *testing.T, entries ...*plugin.Entry) string {
	t.Helper()
	cfg := &config.Config{UI: ui.GetDefaultConfig(), Endpoints: []*endpoint.Endpoint{{Group: "core", Name: "database"}}}
	plugin.Default.SetCore(plugin.CoreConfig, cfg)
	plugin.Default.Reconcile(entries)
	t.Cleanup(func() { plugin.Default.Reconcile(nil) })
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	router := api.New(cfg).Router()
	go func() { _ = router.Listener(listener) }()
	// Closing the listener stops the server. Shutdown is avoided because fasthttp
	// races with request contexts that are still being watched when it runs.
	t.Cleanup(func() { _ = listener.Close() })
	return "http://" + listener.Addr().String()
}

func fetch(t *testing.T, url string, headers ...string) (*http.Response, string) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}
	client := http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var reader io.Reader = response.Body
	if response.Header.Get("Content-Encoding") == "gzip" {
		if reader, err = gzip.NewReader(response.Body); err != nil {
			t.Fatal(err)
		}
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return response, string(data)
}

func TestStatusPageStaysUpWhileTheDatabaseIsDown(t *testing.T) {
	// Nothing listens on port 1, so the database plugin fails and incidents waits.
	base := serve(t,
		entry(t, "database", "type: postgres\npath: \"postgres://gatus@127.0.0.1:1/none?sslmode=disable&connect_timeout=2\"\n"),
		entry(t, "incidents", "trusted-proxies: 0\n"),
		entry(t, "report-pages", "page-size: 20\n"),
	)
	for _, status := range plugin.Default.Statuses() {
		want := map[string]plugin.State{"database": plugin.StateFailed, "incidents": plugin.StateWaiting, "report-pages": plugin.StateActive}[status.Name]
		if status.State != want {
			t.Fatalf("%s is %s, want %s: %s", status.Name, status.State, want, status.Reason)
		}
	}
	response, body := fetch(t, base+"/reports", "Accept-Encoding", "gzip")
	if response.StatusCode != http.StatusServiceUnavailable || !strings.Contains(body, "Reports are unavailable") {
		t.Fatalf("/reports: %d %s", response.StatusCode, body)
	}
	if response.Header.Get("Content-Security-Policy") == "" || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("headers lost on the way out: %v", response.Header)
	}
	for _, path := range []string{"/", "/api/v1/config", "/health"} {
		if response, body := fetch(t, base+path); response.StatusCode != http.StatusOK {
			t.Fatalf("%s while the database is down: %d %s", path, response.StatusCode, body)
		}
	}
}

func TestThroughTheRealServerOnSQLite(t *testing.T) {
	base := serve(t,
		entry(t, "database", "type: sqlite\npath: \""+filepath.Join(t.TempDir(), "plugins.db")+"\"\n"),
		entry(t, "incidents", "trusted-proxies: 0\n"),
		entry(t, "report-pages", "title: Example status\n"),
	)
	response, body := fetch(t, base+"/reports")
	if response.StatusCode != http.StatusOK || !strings.Contains(body, "No reports have been published.") ||
		!strings.Contains(body, "Example status") || response.Header.Get("Cache-Control") != "public, max-age=30" {
		t.Fatalf("/reports: %d %v %s", response.StatusCode, response.Header, body)
	}
	if response, _ := fetch(t, base+"/reports/"+record.NewID()); response.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown report: %d", response.StatusCode)
	}
}
