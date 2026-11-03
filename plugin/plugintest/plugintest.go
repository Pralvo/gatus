// Package plugintest runs one plugin in a real Host for tests.
package plugintest

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TwiN/gatus/v5/plugin"
	"gopkg.in/yaml.v3"
)

// Harness is a Host running the plugins under test.
type Harness struct {
	Host *plugin.Host
	t    *testing.T
}

// Start runs definition with the given YAML config and core services, and fails
// the test if it does not become active. Further definitions are started too,
// which is how a test supplies a fake provider.
func Start(t *testing.T, definition plugin.Definition, configYAML string, core map[plugin.Key]any, others ...plugin.Definition) *Harness {
	t.Helper()
	h := Load(t, definition, configYAML, core, others...)
	for _, status := range h.Host.Statuses() {
		if status.State != plugin.StateActive {
			t.Fatalf("plugin %s is %s: %s", status.Name, status.State, status.Reason)
		}
	}
	return h
}

// Load is Start without the check, for tests of a plugin that must not activate.
func Load(t *testing.T, definition plugin.Definition, configYAML string, core map[plugin.Key]any, others ...plugin.Definition) *Harness {
	t.Helper()
	registry := plugin.NewRegistry()
	registry.Add(definition)
	entries := []*plugin.Entry{entryFor(t, definition.Name, configYAML)}
	for _, other := range others {
		registry.Add(other)
		entries = append(entries, &plugin.Entry{Name: other.Name})
	}
	host := plugin.NewHost(registry)
	for key, value := range core {
		host.SetCore(key, value)
	}
	host.Reconcile(entries)
	t.Cleanup(host.Shutdown)
	return &Harness{Host: host, t: t}
}

func entryFor(t *testing.T, name, configYAML string) *plugin.Entry {
	t.Helper()
	entry := &plugin.Entry{Name: name}
	if strings.TrimSpace(configYAML) == "" {
		return entry
	}
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(configYAML), &document); err != nil {
		t.Fatalf("bad test config: %v", err)
	}
	entry.Config = *document.Content[0]
	return entry
}

// Do sends a request to the plugin's routes and returns the recorded response.
func (h *Harness) Do(request *http.Request) *httptest.ResponseRecorder {
	h.t.Helper()
	recorder := httptest.NewRecorder()
	handler := h.Host.Match(request.Method, request.URL.Path)
	if handler == nil {
		recorder.Code = http.StatusNotFound
		return recorder
	}
	handler.ServeHTTP(recorder, request)
	return recorder
}

// Get is Do for a GET request.
func (h *Harness) Get(path string) *httptest.ResponseRecorder {
	h.t.Helper()
	return h.Do(httptest.NewRequest(http.MethodGet, path, nil))
}
