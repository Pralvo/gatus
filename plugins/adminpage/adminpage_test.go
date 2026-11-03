package adminpage

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
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

func TestEveryFileIsServedWithAStrictPolicy(t *testing.T) {
	h := plugintest.Start(t, Definition, "", nil)
	for pattern, f := range routes {
		path := strings.TrimPrefix(pattern, "GET ")
		response := h.Get(path)
		if response.Code != http.StatusOK || response.Body.Len() == 0 {
			t.Fatalf("%s: %d", path, response.Code)
		}
		want := map[string]string{
			"Content-Type":            f.contentType,
			"Content-Security-Policy": policy,
			"Cache-Control":           "no-store",
			"X-Content-Type-Options":  "nosniff",
			"X-Frame-Options":         "DENY",
			"Referrer-Policy":         "no-referrer",
		}
		for name, value := range want {
			if got := response.Header().Get(name); got != value {
				t.Fatalf("%s %s: %q, want %q", path, name, got, value)
			}
		}
		if response.Header().Get("Set-Cookie") != "" {
			t.Fatalf("%s set a cookie", path)
		}
	}
	for _, unsafe := range []string{"'unsafe-inline'", "'unsafe-eval'", "http:", "https:", "*", "data:"} {
		if strings.Contains(policy, unsafe) {
			t.Fatalf("policy allows %s", unsafe)
		}
	}
}

func read(t *testing.T, name string) string {
	t.Helper()
	data, err := assets.ReadFile("assets/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// The policy would block these anyway. Keeping them out of the files means the
// page works under it, and nothing breaks if a proxy drops the header.
func TestPageHasNothingInlineOrRemote(t *testing.T) {
	page := read(t, "admin.html")
	forbidden := map[string]*regexp.Regexp{
		"inline script":  regexp.MustCompile(`<script(?:\s[^>]*)?>\s*[^<\s]`),
		"script source":  regexp.MustCompile(`<script(?:\s+(?:defer|src="/admin/admin\.js"))*\s*>`),
		"inline style":   regexp.MustCompile(`<style|\sstyle=`),
		"event handler":  regexp.MustCompile(`\son[a-z]+=`),
		"remote address": regexp.MustCompile(`(?:src|href)="(?:[a-z]+:|//)`),
	}
	for name, pattern := range forbidden {
		if name == "script source" {
			if strings.Count(page, "<script") != 1 || !pattern.MatchString(page) {
				t.Fatalf("the page must load exactly one script, its own")
			}
			continue
		}
		if pattern.MatchString(page) {
			t.Fatalf("the page has an %s: %s", name, pattern.FindString(page))
		}
	}
}

// Stored text is hostile, so the script may only ever write text into the page,
// and the token may only ever live in this tab.
func TestScriptNeverWritesMarkupOrKeepsTheTokenElsewhere(t *testing.T) {
	script := read(t, "admin.js")
	for _, sink := range []string{
		"innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "setTimeout('",
		"localStorage", "document.cookie", "indexedDB", "javascript:", "http://", "https://", "credentials: 'include'",
	} {
		if strings.Contains(script, sink) {
			t.Fatalf("the script uses %s", sink)
		}
	}
	for _, needed := range []string{"sessionStorage", "credentials: 'omit'", "createTextNode", "'Bearer '"} {
		if !strings.Contains(script, needed) {
			t.Fatalf("the script no longer uses %s", needed)
		}
	}
	if lines := strings.Count(script, "\n"); lines > 500 {
		t.Fatalf("admin.js has %d lines", lines)
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
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Security-Policy") != policy || !strings.Contains(body, "/admin/admin.js") {
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
