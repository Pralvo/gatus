package feeds

import (
	"encoding/json"
	"encoding/xml"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
)

const validConfig = "base-url: https://status.example.com/\ntitle: Example status"

func core(notices ...*announcement.Announcement) map[plugin.Key]any {
	return map[plugin.Key]any{plugin.CoreConfig: &config.Config{UI: ui.GetDefaultConfig(), Announcements: notices}}
}

func note(day int, kind, message string) *announcement.Announcement {
	return &announcement.Announcement{Timestamp: time.Date(2026, 11, day, 10, 0, 0, 0, time.UTC), Type: kind, Message: message}
}

func TestAtomIsWellFormedNewestFirstAndEscaped(t *testing.T) {
	hostile := `</content><script>alert(1)</script> & "quotes"`
	h := plugintest.Start(t, Definition, validConfig, core(note(1, "operational", "Old"), note(2, "outage", hostile)))
	response := h.Get("/feed/atom.xml")
	if response.Code != http.StatusOK || !strings.HasPrefix(response.Header().Get("Content-Type"), "application/atom+xml") {
		t.Fatalf("got %d %s", response.Code, response.Header().Get("Content-Type"))
	}
	var parsed atomFeed
	if err := xml.Unmarshal(response.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("not well formed: %v\n%s", err, response.Body.String())
	}
	if len(parsed.Entries) != 2 || parsed.Entries[0].Content.Body != hostile {
		t.Fatalf("entries: %+v", parsed.Entries)
	}
	if strings.Contains(response.Body.String(), "<script>") {
		t.Fatal("markup in a notice reached the feed unescaped")
	}
	if parsed.Updated != "2026-11-02T10:00:00Z" {
		t.Fatalf("updated: %s", parsed.Updated)
	}
}

func TestRSSIsWellFormed(t *testing.T) {
	h := plugintest.Start(t, Definition, validConfig, core(note(1, "warning", "Slow & steady")))
	var parsed rssFeed
	if err := xml.Unmarshal(h.Get("/feed/rss.xml").Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	item := parsed.Channel.Items[0]
	if parsed.Version != "2.0" || item.Title != "Warning: Slow & steady" || item.GUID.IsPermaLink != "false" {
		t.Fatalf("item: %+v", item)
	}
}

func TestJSONFeedShape(t *testing.T) {
	h := plugintest.Start(t, Definition, validConfig, core())
	var parsed map[string]any
	if err := json.Unmarshal(h.Get("/feed/feed.json").Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["version"] != "https://jsonfeed.org/version/1.1" {
		t.Fatalf("version: %v", parsed["version"])
	}
	if items, ok := parsed["items"].([]any); !ok || len(items) != 0 {
		t.Fatalf("an empty feed must still have an items array: %v", parsed["items"])
	}
}

func TestEntryIDsAreStableAndContentBased(t *testing.T) {
	first := plugintest.Start(t, Definition, validConfig, core(note(1, "outage", "One")))
	again := plugintest.Start(t, Definition, validConfig, core(note(1, "outage", "One")))
	edited := plugintest.Start(t, Definition, validConfig, core(note(1, "outage", "Two")))
	id := func(h *plugintest.Harness) string {
		var parsed atomFeed
		if err := xml.Unmarshal(h.Get("/feed/atom.xml").Body.Bytes(), &parsed); err != nil {
			t.Fatal(err)
		}
		return parsed.Entries[0].ID
	}
	if id(first) != id(again) {
		t.Fatal("the same notice changed ID between runs")
	}
	if id(first) == id(edited) {
		t.Fatal("an edited notice kept its ID")
	}
	if !strings.HasPrefix(id(first), "tag:status.example.com,2026-11-01:") {
		t.Fatalf("id: %s", id(first))
	}
}

func TestLimitKeepsNewest(t *testing.T) {
	h := plugintest.Start(t, Definition, validConfig+"\nlimit: 1", core(note(1, "none", "Old"), note(2, "none", "New")))
	var parsed atomFeed
	if err := xml.Unmarshal(h.Get("/feed/atom.xml").Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if len(parsed.Entries) != 1 || parsed.Entries[0].Content.Body != "New" {
		t.Fatalf("entries: %+v", parsed.Entries)
	}
}

func TestTitles(t *testing.T) {
	long := strings.Repeat("é", 100)
	cases := map[string]string{
		"# Heading\nbody": "Outage: Heading",
		"  plain  ":       "Outage: plain",
		long:              "Outage: " + strings.Repeat("é", 79) + "…",
	}
	for message, want := range cases {
		if got := titleOf(note(1, "outage", message)); got != want {
			t.Fatalf("%q: got %q", message, got)
		}
	}
	if got := titleOf(note(1, "none", "Plain")); got != "Plain" {
		t.Fatalf("no label: %q", got)
	}
}

func TestBadConfigIsRefusedByName(t *testing.T) {
	cases := map[string]string{
		"missing base":  "",
		"relative base": "base-url: /status",
		"bad scheme":    "base-url: ftp://example.com",
		"zero limit":    validConfig + "\nlimit: 0",
		"misspelt":      validConfig + "\nlimt: 5",
	}
	for name, cfg := range cases {
		t.Run(name, func(t *testing.T) {
			h := plugintest.Load(t, Definition, cfg, core())
			if got := h.Host.Statuses()[0]; got.State != plugin.StateFailed || got.Reason == "" {
				t.Fatalf("status: %+v", got)
			}
			if h.Get("/feed/atom.xml").Code != http.StatusNotFound {
				t.Fatal("a failed plugin served a route")
			}
		})
	}
}
