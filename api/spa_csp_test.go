package api

import (
	"io"
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

func TestSinglePageApplicationLinksTheFeedsOnlyWhenTheyRun(t *testing.T) {
	for _, feeds := range []bool{false, true} {
		cfg := &config.Config{UI: &ui.Config{Title: "example-title", Feeds: feeds}}
		response, err := New(cfg).Router().Test(httptest.NewRequest(http.MethodGet, "/", http.NoBody))
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		page := strings.Join(strings.Fields(string(body)), " ")
		for _, link := range []string{
			`rel="alternate" type="application/atom+xml" title="example-title (Atom)" href="/feed/atom.xml"`,
			`rel="alternate" type="application/rss+xml" title="example-title (RSS)" href="/feed/rss.xml"`,
			`rel="alternate" type="application/feed+json" title="example-title (JSON Feed)" href="/feed/feed.json"`,
		} {
			if strings.Contains(page, link) != feeds {
				t.Errorf("feeds %t: link %q present %t in:\n%s", feeds, link, !feeds, page)
			}
		}
		if !feeds && strings.Contains(page, `rel="alternate"`) {
			t.Errorf("feeds are off but the page offers one:\n%s", page)
		}
	}
}
