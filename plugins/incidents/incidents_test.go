package incidents

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/notice"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const secret = "plugin-test-token-0123456789abcdef"

func tokenConfig() string {
	sum := sha256.Sum256([]byte(secret))
	return "tokens:\n  - name: alice\n    sha256: " + hex.EncodeToString(sum[:]) + "\n"
}

// provider offers a ready database under the database key, because the harness
// gives further definitions no config.
func provider(db *database.DB) plugin.Definition {
	return plugin.Definition{
		Name:     "database",
		Provides: []plugin.Key{database.Key},
		Start:    func(ctx *plugin.Context) error { ctx.Provide(database.Key, db); return nil },
	}
}

func gatusConfig() map[plugin.Key]any {
	return map[plugin.Key]any{plugin.CoreConfig: &config.Config{
		Endpoints:         []*endpoint.Endpoint{{Group: "core", Name: "database"}},
		ExternalEndpoints: []*endpoint.ExternalEndpoint{{Group: "ext", Name: "batch"}},
	}}
}

func post(t *testing.T, h *plugintest.Harness, method, path, body string) map[string]any {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+secret)
	response := h.Do(request)
	if response.Code >= http.StatusMultipleChoices {
		t.Fatalf("%s %s: %d %s", method, path, response.Code, response.Body)
	}
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func waitForNotice(t *testing.T, match func([]*announcement.Announcement) bool) []*announcement.Announcement {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		current := notice.All(nil)
		if match(current) {
			return current
		}
		if time.Now().After(deadline) {
			t.Fatalf("notices never matched: %d present", len(current))
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestPluginEndToEnd(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		h := plugintest.Start(t, Definition, tokenConfig(), gatusConfig(), provider(db))

		incident := post(t, h, http.MethodPost, "/api/v1/admin/incidents", `{"title":"Database down","severity":"critical"}`)
		if incident["created_by"] != "alice" {
			t.Fatalf("actor: %+v", incident)
		}
		report := post(t, h, http.MethodPost, "/api/v1/admin/reports",
			`{"title":"Writes failing","stage":"investigating","message":"We are looking.","published":true,"endpoints":[{"key":"core_database","impact":"major"},{"key":"ext_batch","impact":"degraded"}]}`)
		id := report["id"].(string)

		notices := waitForNotice(t, func(n []*announcement.Announcement) bool { return len(n) == 1 })
		if notices[0].Type != announcement.TypeOutage || notices[0].Archived ||
			!strings.Contains(notices[0].Message, "We are looking.") || !strings.Contains(notices[0].Message, "(/reports/"+id+")") {
			t.Fatalf("notice: %+v", notices[0])
		}
		if err := notices[0].ValidateAndSetDefaults(); err != nil {
			t.Fatalf("not a valid announcement: %v", err)
		}

		post(t, h, http.MethodPost, "/api/v1/admin/reports/"+id+"/updates", `{"stage":"resolved","message":"All clear."}`)
		notices = waitForNotice(t, func(n []*announcement.Announcement) bool { return len(n) == 1 && n[0].Archived })
		if notices[0].Type != announcement.TypeOperational || !strings.Contains(notices[0].Message, "All clear.") {
			t.Fatalf("notice: %+v", notices[0])
		}

		post(t, h, http.MethodPut, "/api/v1/admin/reports/"+id+"/publication", `{"published":false}`)
		waitForNotice(t, func(n []*announcement.Announcement) bool { return len(n) == 0 })

		// The notices leave with the plugin.
		post(t, h, http.MethodPut, "/api/v1/admin/reports/"+id+"/publication", `{"published":true}`)
		waitForNotice(t, func(n []*announcement.Announcement) bool { return len(n) == 1 })
		h.Host.Shutdown()
		if got := notice.All(nil); len(got) != 0 {
			t.Fatalf("notices outlived the plugin: %+v", got)
		}
	})
}

func TestUnknownEndpointIsRefusedThroughTheAPI(t *testing.T) {
	h := plugintest.Start(t, Definition, tokenConfig(), gatusConfig(), provider(databasetest.SQLite(t)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/reports",
		bytes.NewBufferString(`{"title":"x","stage":"identified","message":"y","endpoints":[{"key":"core_web","impact":"major"}]}`))
	request.Header.Set("Authorization", "Bearer "+secret)
	if response := h.Do(request); response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "unknown_endpoint") {
		t.Fatalf("%d %s", response.Code, response.Body)
	}
}

func TestPublishesEventsAndProvidesTheService(t *testing.T) {
	var service record.Service
	var seen []string
	consumer := plugin.Definition{
		Name:  "consumer",
		Needs: []plugin.Key{Key},
		Start: func(ctx *plugin.Context) error {
			service = plugin.Get[record.Service](ctx, Key)
			ctx.On(record.TopicIncidentCreated, func(event plugin.Event) {
				seen = append(seen, event.Data.(record.IncidentEvent).Incident.Title)
			})
			return nil
		},
	}
	plugintest.Start(t, Definition, tokenConfig(), gatusConfig(), provider(databasetest.SQLite(t)), consumer)
	if service == nil {
		t.Fatal("no service")
	}
	if _, err := service.CreateIncident(t.Context(), "bot", record.NewIncident{Title: "From a plugin", Severity: record.SeverityMinor}); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 1 || seen[0] != "From a plugin" {
		t.Fatalf("events: %v", seen)
	}
}

func statusOf(t *testing.T, h *plugintest.Harness, name string) plugin.Status {
	t.Helper()
	for _, s := range h.Host.Statuses() {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("no status for %s", name)
	return plugin.Status{}
}

func TestWaitsForTheDatabase(t *testing.T) {
	h := plugintest.Load(t, Definition, tokenConfig(), gatusConfig())
	got := statusOf(t, h, "incidents")
	if got.State != plugin.StateWaiting || !strings.Contains(got.Reason, "database") {
		t.Fatalf("status: %+v", got)
	}
}

func TestStartFailuresAreNamed(t *testing.T) {
	t.Run("bad token", func(t *testing.T) {
		h := plugintest.Load(t, Definition, "tokens:\n  - name: alice\n    sha256: short\n", gatusConfig(), provider(databasetest.SQLite(t)))
		if got := statusOf(t, h, "incidents"); got.State != plugin.StateFailed || !strings.Contains(got.Reason, "64 hex") {
			t.Fatalf("status: %+v", got)
		}
	})
	t.Run("unknown field", func(t *testing.T) {
		h := plugintest.Load(t, Definition, "token: x\n", gatusConfig(), provider(databasetest.SQLite(t)))
		if got := statusOf(t, h, "incidents"); got.State != plugin.StateFailed {
			t.Fatalf("status: %+v", got)
		}
	})
	t.Run("failed migration", func(t *testing.T) {
		db := databasetest.SQLite(t)
		if _, err := db.SQL().Exec(`CREATE TABLE incident_records (wrong INTEGER)`); err != nil {
			t.Fatal(err)
		}
		h := plugintest.Load(t, Definition, tokenConfig(), gatusConfig(), provider(db))
		if got := statusOf(t, h, "incidents"); got.State != plugin.StateFailed || !strings.Contains(got.Reason, "incidents to version 1") {
			t.Fatalf("status: %+v", got)
		}
		if got := h.Host.Match(http.MethodGet, "/api/v1/admin/incidents"); got != nil {
			t.Fatal("routes went live after a failed start")
		}
	})
	t.Run("database gone", func(t *testing.T) {
		db := databasetest.SQLite(t)
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
		h := plugintest.Load(t, Definition, tokenConfig(), gatusConfig(), provider(db))
		if got := statusOf(t, h, "incidents"); got.State != plugin.StateFailed {
			t.Fatalf("status: %+v", got)
		}
	})
}
