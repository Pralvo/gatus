package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/config/ui"
)

func TestSinglePageApplicationSendsItsSecurityPolicy(t *testing.T) {
	cfg := &config.Config{
		Endpoints: []*endpoint.Endpoint{{Name: "frontend", Group: "core"}},
		UI: &ui.Config{
			Title:         "example-title",
			BrowserChecks: []ui.Button{{Name: "Home", Link: "https://example.org/"}},
		},
	}
	router := New(cfg).Router()
	for _, path := range []string{"/", "/endpoints/core_frontend", "/suites/any"} {
		response, err := router.Test(httptest.NewRequest(http.MethodGet, path, http.NoBody))
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		policy := response.Header.Get("Content-Security-Policy")
		if !strings.Contains(policy, "script-src 'self';") || !strings.Contains(policy, "connect-src 'self' https://example.org;") {
			t.Errorf("%s: policy %q", path, policy)
		}
		if response.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: missing nosniff", path)
		}
	}
}
