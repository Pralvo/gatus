package adminpage

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/api"
	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	_ "github.com/TwiN/gatus/v5/plugins/incidents" // registers incidents and database
	"gopkg.in/yaml.v3"
)

func TestEveryAdminAddressGetsThePageWithAStrictPolicy(t *testing.T) {
	h := plugintest.Start(t, Definition, "", nil)
	for _, path := range []string{"/admin", "/admin/reports/0123456789abcdef0123456789abcdef", "/admin/incidents"} {
		response := h.Get(path)
		if response.Code != http.StatusOK || response.Header().Get("Content-Security-Policy") != policy {
			t.Fatalf("%s: %d %v", path, response.Code, response.Header())
		}
		for header, want := range map[string]string{"Cache-Control": "no-store", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff"} {
			if got := response.Header().Get(header); got != want {
				t.Fatalf("%s: %s is %q", path, header, got)
			}
		}
	}
	if strings.Contains(policy, "unsafe") || !strings.Contains(policy, "frame-ancestors 'none'") {
		t.Fatalf("policy: %s", policy)
	}
}

// The built page may load only its own /assets/ files and must hold no inline
// script, so the policy above never has to allow one.
func TestBuiltPageHasNothingInlineOrRemote(t *testing.T) {
	page, err := readPage()
	if err != nil {
		t.Fatalf("the admin entry is not in web/static: %v", err)
	}
	html := string(page)
	for _, script := range regexp.MustCompile(`<script[^>]*>`).FindAllString(html, -1) {
		if !regexp.MustCompile(`src="/assets/[A-Za-z0-9._-]+\.js"`).MatchString(script) {
			t.Fatalf("inline or remote script: %s", script)
		}
	}
	if regexp.MustCompile(`(?i)(src|href)="(https?:)?//`).MatchString(html) || strings.Contains(html, " style=") || regexp.MustCompile(`\son[a-z]+=`).MatchString(html) {
		t.Fatalf("the page loads from another origin or has inline style or handlers:\n%s", html)
	}
}

func TestMissingPageFailsByName(t *testing.T) {
	original := readPage
	readPage = func() ([]byte, error) { return nil, errors.New("gone") }
	t.Cleanup(func() { readPage = original })
	h := plugintest.Load(t, Definition, "", nil)
	if got := h.Host.Statuses()[0]; got.State != plugin.StateFailed || !strings.Contains(got.Reason, "make frontend-build") {
		t.Fatalf("status: %+v", got)
	}
}

func TestUnknownSettingFails(t *testing.T) {
	h := plugintest.Load(t, Definition, "title: x", nil)
	if got := h.Host.Statuses()[0]; got.State != plugin.StateFailed {
		t.Fatalf("status: %+v", got)
	}
}

func entry(t *testing.T, name, configYAML string) *plugin.Entry {
	t.Helper()
	if configYAML == "" {
		return &plugin.Entry{Name: name}
	}
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(configYAML), &document); err != nil {
		t.Fatal(err)
	}
	return &plugin.Entry{Name: name, Config: *document.Content[0]}
}

func get(t *testing.T, url, token string) (*http.Response, string) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	client := http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response, string(body)
}

// The page and the API it calls, in the real host behind the real router.
func TestPageAndAPIThroughTheRealServer(t *testing.T) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	token := hex.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	cfg := &config.Config{UI: ui.GetDefaultConfig()}
	plugin.Default.SetCore(plugin.CoreConfig, cfg)
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
	base := "http://" + listener.Addr().String()

	// Without the incidents plugin the API is absent, and the page tells that
	// apart from a refused token because the answer is not JSON.
	plugin.Default.Reconcile([]*plugin.Entry{entry(t, "admin-page", "")})
	if response, _ := get(t, base+"/api/v1/admin/reports?limit=1", token); response.StatusCode != http.StatusNotFound ||
		strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("absent API: %d %s", response.StatusCode, response.Header.Get("Content-Type"))
	}

	plugin.Default.Reconcile([]*plugin.Entry{
		entry(t, "database", "type: sqlite\npath: \""+filepath.Join(t.TempDir(), "plugins.db")+"\"\n"),
		entry(t, "incidents", "tokens:\n  - name: alice\n    sha256: "+hex.EncodeToString(sum[:])+"\n"),
		entry(t, "admin-page", ""),
	})
	response, body := get(t, base+"/admin", "")
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Security-Policy") != policy || !strings.Contains(body, "/assets/") {
		t.Fatalf("/admin: %d %v", response.StatusCode, response.Header)
	}
	if response, _ := get(t, base+"/api/v1/admin/reports?limit=1", token); response.StatusCode != http.StatusOK {
		t.Fatalf("good token: %d", response.StatusCode)
	}
	response, body = get(t, base+"/api/v1/admin/reports?limit=1", token[:len(token)-1]+"x")
	if response.StatusCode != http.StatusUnauthorized || !strings.Contains(body, `"unauthorized"`) {
		t.Fatalf("bad token: %d %s", response.StatusCode, body)
	}
}
