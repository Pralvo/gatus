package incidents

import (
	"encoding/json"
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
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"gopkg.in/yaml.v3"
)

func entry(t *testing.T, name, configYAML string) *plugin.Entry {
	t.Helper()
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(configYAML), &document); err != nil {
		t.Fatal(err)
	}
	return &plugin.Entry{Name: name, Config: *document.Content[0]}
}

// serve runs both plugins in the real host behind the real router and a real
// socket, the way the gatus binary does.
func serve(t *testing.T, databaseType, path string) string {
	t.Helper()
	cfg := &config.Config{UI: ui.GetDefaultConfig(), Endpoints: []*endpoint.Endpoint{{Group: "core", Name: "database"}}}
	plugin.Default.SetCore(plugin.CoreConfig, cfg)
	statuses := plugin.Default.Reconcile([]*plugin.Entry{
		entry(t, "database", "type: "+databaseType+"\npath: \""+path+"\"\n"),
		entry(t, "incidents", tokenConfig()),
	})
	t.Cleanup(func() { plugin.Default.Reconcile(nil) })
	for _, status := range statuses {
		if status.State != plugin.StateActive {
			t.Fatalf("%s is %s: %s", status.Name, status.State, status.Reason)
		}
	}
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

type wire struct {
	t    *testing.T
	base string
}

func (w wire) send(method, path, token, body string, headers ...string) (*http.Response, string) {
	w.t.Helper()
	request, err := http.NewRequest(method, w.base+path, strings.NewReader(body))
	if err != nil {
		w.t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		request.Header.Set(headers[i], headers[i+1])
	}
	client := http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		w.t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		w.t.Fatal(err)
	}
	return response, string(data)
}

func (w wire) want(status int, method, path, token, body string) string {
	w.t.Helper()
	response, data := w.send(method, path, token, body)
	if response.StatusCode != status {
		w.t.Fatalf("%s %s: %d, want %d: %s", method, path, response.StatusCode, status, data)
	}
	return data
}

func TestThroughTheRealServer(t *testing.T) {
	run := func(t *testing.T, databaseType, path string) {
		w := wire{t, serve(t, databaseType, path)}
		const admin = "/api/v1/admin"
		w.want(http.StatusUnauthorized, http.MethodGet, admin+"/incidents", "", "")

		var incident struct {
			ID        string `json:"id"`
			CreatedBy string `json:"created_by"`
		}
		created := w.want(http.StatusCreated, http.MethodPost, admin+"/incidents", secret, `{"title":"Down <b>","severity":"major"}`)
		if err := json.Unmarshal([]byte(created), &incident); err != nil || incident.CreatedBy != "alice" {
			t.Fatalf("created: %v %s", err, created)
		}
		w.want(http.StatusOK, http.MethodPatch, admin+"/incidents/"+incident.ID, secret, `{"commander":"carol"}`)
		w.want(http.StatusConflict, http.MethodPost, admin+"/incidents/"+incident.ID+"/state", secret, `{"state":"closed"}`)

		response, _ := w.send(http.MethodGet, admin+"/incidents", secret, "")
		for name, want := range map[string]string{"Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"} {
			if got := response.Header.Get(name); got != want {
				t.Fatalf("%s: %q", name, got)
			}
		}
		compressed, _ := w.send(http.MethodGet, admin+"/incidents", secret, "", "Accept-Encoding", "gzip")
		if compressed.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("headers lost through compression: %v", compressed.Header)
		}
		w.want(http.StatusRequestEntityTooLarge, http.MethodPost, admin+"/incidents", secret, `{"title":"`+strings.Repeat("a", 2<<20)+`"}`)

		w.want(http.StatusCreated, http.MethodPost, admin+"/reports", secret,
			`{"title":"Slow *reads*","stage":"identified","message":"Working. <script>x</script>","published":true,"endpoints":[{"key":"core_database","impact":"major"}]}`)
		deadline := time.Now().Add(5 * time.Second)
		for {
			var page struct {
				Announcements []struct {
					Message string `json:"message"`
				} `json:"announcements"`
			}
			if err := json.Unmarshal([]byte(w.want(http.StatusOK, http.MethodGet, "/api/v1/config", "", "")), &page); err != nil {
				t.Fatal(err)
			}
			if len(page.Announcements) == 1 {
				if message := page.Announcements[0].Message; !strings.Contains(message, `\<script\>`) || !strings.Contains(message, `Slow \*reads\*`) {
					t.Fatalf("stored text reached the page as markup: %s", message)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("no notice on the page: %+v", page)
			}
			time.Sleep(10 * time.Millisecond)
		}

		// Last, because this blocks the address for the rest of the minute. The
		// first request above was already one failure.
		for range 9 {
			w.want(http.StatusUnauthorized, http.MethodGet, admin+"/incidents", "guess", "")
		}
		w.want(http.StatusTooManyRequests, http.MethodGet, admin+"/incidents", secret, "")
		w.want(http.StatusOK, http.MethodGet, "/api/v1/config", "", "")
	}
	t.Run("sqlite", func(t *testing.T) { run(t, "sqlite", filepath.Join(t.TempDir(), "plugins.db")) })
	t.Run("postgres", func(t *testing.T) { run(t, "postgres", databasetest.PostgresDSN(t)) })
}
