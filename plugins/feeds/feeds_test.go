package feeds

import (
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	"github.com/TwiN/gatus/v5/plugins/incidents"
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
		"**Bold**\nbody":  "Outage: Bold",
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
		"huge limit":    validConfig + "\nlimit: 201",
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

func TestEntriesFromReportsLinkToTheReportPage(t *testing.T) {
	const id = "0123456789abcdef0123456789abcdef"
	const other = "fedcba9876543210fedcba9876543210"
	fromReport := "**Identified: Slow**\n\nWorking.\n\n[Read the report](/reports/" + id + ")"
	imitation := "**Identified: x](/reports/" + other + ")**\n\nWorking."
	h := plugintest.Start(t, Definition, validConfig, core(note(3, "warning", fromReport), note(2, "warning", imitation), note(1, "none", "Plain")))
	want := []string{"https://status.example.com/reports/" + id, "https://status.example.com/", "https://status.example.com/"}

	var atom atomFeed
	if err := xml.Unmarshal(h.Get("/feed/atom.xml").Body.Bytes(), &atom); err != nil {
		t.Fatal(err)
	}
	var rss rssFeed
	if err := xml.Unmarshal(h.Get("/feed/rss.xml").Body.Bytes(), &rss); err != nil {
		t.Fatal(err)
	}
	var feed jsonFeed
	if err := json.Unmarshal(h.Get("/feed/feed.json").Body.Bytes(), &feed); err != nil {
		t.Fatal(err)
	}
	for i, link := range want {
		if atom.Entries[i].Link.Href != link || rss.Channel.Items[i].Link != link || feed.Items[i].URL != link {
			t.Fatalf("entry %d: atom %q, rss %q, json %q, want %q", i, atom.Entries[i].Link.Href, rss.Channel.Items[i].Link, feed.Items[i].URL, link)
		}
	}
}

// item is one entry as a reader sees it, whatever the format.
type item struct{ id, title, content, link, updated string }

// readAll fetches all three feeds, checks each against its specification, and
// returns their entries in order. A test that reads feeds through it checks
// the specifications on every feed it sees.
func readAll(t *testing.T, get func(path string) (int, string)) [3][]item {
	t.Helper()
	return [3][]item{checkAtom(t, get), checkRSS(t, get), checkJSON(t, get)}
}

func fetch(t *testing.T, get func(path string) (int, string), path string) string {
	t.Helper()
	code, body := get(path)
	if code != http.StatusOK {
		t.Fatalf("%s: status %d", path, code)
	}
	return body
}

func checkTime(t *testing.T, where, layout, value string) {
	t.Helper()
	if _, err := time.Parse(layout, value); err != nil {
		t.Errorf("%s: %q is not a %s date: %v", where, value, layout, err)
	}
}

func checkUnique(t *testing.T, format string, items []item) {
	t.Helper()
	seen := map[string]bool{}
	for _, i := range items {
		if i.id == "" || seen[i.id] {
			t.Errorf("%s: missing or repeated ID %q", format, i.id)
		}
		seen[i.id] = true
		if parsed, err := url.Parse(i.link); err != nil || !parsed.IsAbs() {
			t.Errorf("%s: link %q is not absolute", format, i.link)
		}
	}
}

// checkAtom checks RFC 4287: the feed's id, title, updated and author, and each
// entry's id, title and updated, all dates in RFC 3339.
func checkAtom(t *testing.T, get func(path string) (int, string)) []item {
	t.Helper()
	const ns = "http://www.w3.org/2005/Atom"
	var doc struct {
		XMLName xml.Name
		ID      string `xml:"http://www.w3.org/2005/Atom id"`
		Title   string `xml:"http://www.w3.org/2005/Atom title"`
		Updated string `xml:"http://www.w3.org/2005/Atom updated"`
		Author  string `xml:"http://www.w3.org/2005/Atom author>name"`
		Entries []struct {
			ID        string `xml:"http://www.w3.org/2005/Atom id"`
			Title     string `xml:"http://www.w3.org/2005/Atom title"`
			Updated   string `xml:"http://www.w3.org/2005/Atom updated"`
			Published string `xml:"http://www.w3.org/2005/Atom published"`
			Content   string `xml:"http://www.w3.org/2005/Atom content"`
			Link      struct {
				Href string `xml:"href,attr"`
			} `xml:"http://www.w3.org/2005/Atom link"`
		} `xml:"http://www.w3.org/2005/Atom entry"`
	}
	if err := xml.Unmarshal([]byte(fetch(t, get, "/feed/atom.xml")), &doc); err != nil {
		t.Fatalf("atom is not well formed: %v", err)
	}
	if doc.XMLName.Space != ns || doc.XMLName.Local != "feed" || doc.ID == "" || doc.Title == "" || doc.Author == "" {
		t.Fatalf("atom feed lacks a required element: %+v", doc)
	}
	checkTime(t, "atom feed updated", time.RFC3339, doc.Updated)
	items := make([]item, 0, len(doc.Entries))
	for _, e := range doc.Entries {
		if e.ID == "" || e.Title == "" {
			t.Errorf("atom entry lacks an id or title: %+v", e)
		}
		checkTime(t, "atom entry updated", time.RFC3339, e.Updated)
		checkTime(t, "atom entry published", time.RFC3339, e.Published)
		items = append(items, item{e.ID, e.Title, e.Content, e.Link.Href, e.Updated})
	}
	checkUnique(t, "atom", items)
	return items
}

// checkRSS checks RSS 2.0: the channel's title, link and description, and each
// item's guid, which is not a permalink, and RFC 822 pubDate.
func checkRSS(t *testing.T, get func(path string) (int, string)) []item {
	t.Helper()
	var doc struct {
		XMLName     xml.Name
		Version     string `xml:"version,attr"`
		Title       string `xml:"channel>title"`
		Link        string `xml:"channel>link"`
		Description string `xml:"channel>description"`
		Built       string `xml:"channel>lastBuildDate"`
		Items       []struct {
			Title       string `xml:"title"`
			Link        string `xml:"link"`
			Description string `xml:"description"`
			PubDate     string `xml:"pubDate"`
			GUID        struct {
				IsPermaLink string `xml:"isPermaLink,attr"`
				Value       string `xml:",chardata"`
			} `xml:"guid"`
		} `xml:"channel>item"`
	}
	if err := xml.Unmarshal([]byte(fetch(t, get, "/feed/rss.xml")), &doc); err != nil {
		t.Fatalf("rss is not well formed: %v", err)
	}
	if doc.XMLName.Local != "rss" || doc.Version != "2.0" || doc.Title == "" || doc.Link == "" || doc.Description == "" {
		t.Fatalf("rss channel lacks a required element: %+v", doc)
	}
	checkTime(t, "rss lastBuildDate", time.RFC1123Z, doc.Built)
	items := make([]item, 0, len(doc.Items))
	for _, i := range doc.Items {
		if i.Title == "" || i.GUID.IsPermaLink != "false" {
			t.Errorf("rss item lacks a title or a non-permalink guid: %+v", i)
		}
		checkTime(t, "rss pubDate", time.RFC1123Z, i.PubDate)
		items = append(items, item{i.GUID.Value, i.Title, i.Description, i.Link, i.PubDate})
	}
	checkUnique(t, "rss", items)
	return items
}

// checkJSON checks JSON Feed 1.1: version and title, and each item's string id,
// content_text or content_html, and RFC 3339 dates.
func checkJSON(t *testing.T, get func(path string) (int, string)) []item {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(fetch(t, get, "/feed/feed.json")), &doc); err != nil {
		t.Fatalf("json feed is not JSON: %v", err)
	}
	title, _ := doc["title"].(string)
	list, isList := doc["items"].([]any)
	if doc["version"] != "https://jsonfeed.org/version/1.1" || title == "" || !isList {
		t.Fatalf("json feed lacks a required member: %v", doc)
	}
	items := make([]item, 0, len(list))
	for _, raw := range list {
		member, _ := raw.(map[string]any)
		id, isString := member["id"].(string)
		text, hasText := member["content_text"].(string)
		_, hasHTML := member["content_html"].(string)
		if !isString || (!hasText && !hasHTML) {
			t.Errorf("json item lacks a string id or content: %v", member)
		}
		for _, field := range []string{"date_published", "date_modified"} {
			value, _ := member[field].(string)
			checkTime(t, "json "+field, time.RFC3339, value)
		}
		link, _ := member["url"].(string)
		itemTitle, _ := member["title"].(string)
		modified, _ := member["date_modified"].(string)
		items = append(items, item{id, itemTitle, text, link, modified})
	}
	checkUnique(t, "json", items)
	return items
}

// getter reads from a harness.
func getter(h *plugintest.Harness) func(path string) (int, string) {
	return func(path string) (int, string) {
		response := h.Get(path)
		return response.Code, response.Body.String()
	}
}

func TestEveryFormatMeetsItsSpecification(t *testing.T) {
	h := plugintest.Start(t, Definition, validConfig, core(note(1, "outage", "One"), note(2, "none", "Two"), note(2, "warning", "Same time")))
	feeds := readAll(t, getter(h))
	for format, items := range feeds {
		if len(items) != 3 {
			t.Fatalf("format %d: %d entries", format, len(items))
		}
		for i := range items {
			if items[i].id != feeds[0][i].id || items[i].title != feeds[0][i].title {
				t.Fatalf("format %d disagrees with atom at entry %d: %+v", format, i, items[i])
			}
		}
	}
}

func TestEmptyFeedsMeetTheirSpecification(t *testing.T) {
	h := plugintest.Start(t, Definition, validConfig, core())
	for format, items := range readAll(t, getter(h)) {
		if len(items) != 0 {
			t.Fatalf("format %d: %+v", format, items)
		}
	}
}

func TestHostileTextStaysText(t *testing.T) {
	hostile := `</title></entry><script>x()</script>]]>&amp;<img src=x onerror=x()>"'`
	h := plugintest.Start(t, Definition, validConfig, core(note(1, "none", hostile+"\n\n"+hostile)))
	for format, items := range readAll(t, getter(h)) {
		if len(items) != 1 || items[0].title != hostile || items[0].content != hostile+"\n\n"+hostile {
			t.Fatalf("format %d changed the text: %+v", format, items)
		}
	}
	for _, path := range []string{"/feed/atom.xml", "/feed/rss.xml", "/feed/feed.json"} {
		body := h.Get(path).Body.String()
		if strings.Contains(body, "<script>") || strings.Contains(body, "<img") || strings.Contains(body, "</entry><") {
			t.Fatalf("%s: markup reached the feed unescaped:\n%s", path, body)
		}
	}
	// A character XML cannot hold must not break the document.
	broken := plugintest.Start(t, Definition, validConfig, core(note(1, "none", "Bell\x07 and nul\x00")))
	readAll(t, getter(broken))
}

func TestHabitualAddressesRedirectToTheFeeds(t *testing.T) {
	h := plugintest.Start(t, Definition, validConfig, core())
	for from, to := range map[string]string{
		"/feed.json": "/feed/feed.json",
		"/feed.atom": "/feed/atom.xml",
		"/atom.xml":  "/feed/atom.xml",
		"/rss.xml":   "/feed/rss.xml",
		"/feed.xml":  "/feed/rss.xml",
	} {
		response := h.Get(from)
		if response.Code != http.StatusMovedPermanently || response.Header().Get("Location") != to {
			t.Errorf("%s: %d to %q", from, response.Code, response.Header().Get("Location"))
		}
	}
	if h.Get("/feed/feed.json").Code != http.StatusOK || h.Get("/feed").Code != http.StatusNotFound {
		t.Fatal("a redirect replaced a real route or added one")
	}
}

func TestReportNoticesAreNamedAsTheIncidentsPluginNamesThem(t *testing.T) {
	if incidentsNotices != incidents.NoticeSource || incidentsKey != incidents.Key {
		t.Fatal("the feeds would not recognise the incidents plugin")
	}
}
