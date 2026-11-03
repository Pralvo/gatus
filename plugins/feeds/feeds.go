// Package feeds publishes status notices, reports and, if asked, check results
// as Atom, RSS and JSON feeds, so that people can follow them without an
// account. It stores nothing: every entry is built from records kept elsewhere.
package feeds

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/notice"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const (
	// maxTitleLength keeps a title readable in a feed reader. It counts characters.
	maxTitleLength = 80
	// maxLimit bounds the work one request can cause.
	maxLimit = record.MaxLimit
)

// cacheFor is how long built entries are reused, so a busy feed reads the
// stores a few times a minute at most. A report change clears it at once.
var cacheFor = 10 * time.Second

// incidentsKey is the service the incidents plugin provides, and
// incidentsNotices the name its notices are added under. They are written out
// rather than imported, so that this plugin needs only package record.
const (
	incidentsKey     plugin.Key = "incidents"
	incidentsNotices            = "incidents"
)

// Config is the plugin's config: block.
type Config struct {
	// BaseURL is the public address of the status page. It is required because
	// the service cannot learn its public name safely from a request header.
	BaseURL string `yaml:"base-url"`
	// Title names the feed. It defaults to the page title.
	Title string `yaml:"title"`
	// Limit is the most entries a feed returns. It also bounds how far back the
	// feed reaches: reports stay in it until newer entries push them out.
	Limit int `yaml:"limit"`
	// StatusChanges adds an entry each time an endpoint the page shows starts
	// failing its checks or passes them again. It is off unless set.
	StatusChanges bool `yaml:"status-changes"`
}

func init() { plugin.Register(Definition) }

// redirects send addresses people try by habit to the real feeds.
var redirects = [][2]string{
	{"/feed.json", "/feed/feed.json"},
	{"/feed.atom", "/feed/atom.xml"},
	{"/atom.xml", "/feed/atom.xml"},
	{"/rss.xml", "/feed/rss.xml"},
	{"/feed.xml", "/feed/rss.xml"},
}

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "feeds",
	Description: "Atom, RSS and JSON feeds of notices, reports and status changes.",
	Needs:       []plugin.Key{plugin.CoreConfig},
	Wants:       []plugin.Key{incidentsKey},
	Start: func(ctx *plugin.Context) error {
		cfg := Config{Limit: 50}
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		base, err := url.Parse(cfg.BaseURL)
		if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Host == "" {
			return errors.New("base-url must be an absolute http or https address")
		}
		if cfg.Limit < 1 || cfg.Limit > maxLimit {
			return fmt.Errorf("limit must be between 1 and %d", maxLimit)
		}
		gatusConfig := plugin.Get[*config.Config](ctx, plugin.CoreConfig)
		if cfg.Title == "" && gatusConfig.UI != nil {
			cfg.Title = gatusConfig.UI.Title
		}
		f := &feed{
			config:   cfg,
			base:     strings.TrimRight(base.String(), "/"),
			host:     base.Hostname(),
			started:  time.Now().UTC(),
			now:      time.Now,
			cacheFor: cacheFor,
			logf:     ctx.Logf,
		}
		// Reports, when the incidents plugin runs, come from the reports
		// themselves, so they keep a stable ID and outlive the page's notices.
		if service := plugin.Get[record.Service](ctx, incidentsKey); service != nil {
			f.reports = service
			f.notices = func() []*announcement.Announcement {
				return notice.Except(gatusConfig.Announcements, incidentsNotices)
			}
			for _, topic := range record.ReportTopics {
				ctx.On(topic, func(plugin.Event) { f.clear() })
			}
		} else {
			f.notices = func() []*announcement.Announcement { return notice.All(gatusConfig.Announcements) }
		}
		if cfg.StatusChanges {
			f.statuses = storedStatuses(cfg.Limit)
		}
		ctx.HandleFunc("GET /feed/atom.xml", f.atom)
		ctx.HandleFunc("GET /feed/rss.xml", f.rss)
		ctx.HandleFunc("GET /feed/feed.json", f.json)
		for _, r := range redirects {
			ctx.Handle("GET "+r[0], http.RedirectHandler(r[1], http.StatusMovedPermanently))
		}
		return nil
	},
}

// feed renders one list of entries in several formats.
type feed struct {
	config   Config
	base     string
	host     string
	started  time.Time
	now      func() time.Time
	cacheFor time.Duration
	logf     func(format string, args ...any)
	notices  func() []*announcement.Announcement
	reports  reportLister // nil without the incidents plugin
	statuses statusReader // nil unless status-changes is set
	mu       sync.Mutex   // guards everything below
	cached   []entry      // nil when it must be rebuilt
	builtAt  time.Time    // when cached was built
	reported []entry      // the last report entries read, served if a read fails
	failing  bool         // whether the last report read failed
}

// entry is one item in the shape every format needs. Published is when it
// first appeared and time when it last changed; they differ for an edited report.
type entry struct {
	id        string
	title     string
	content   string
	link      string
	published time.Time
	time      time.Time
}

// clear makes the next request rebuild the entries.
func (f *feed) clear() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cached = nil
}

// entries returns the newest entries first, at most limit of them. One request
// rebuilds them while others wait, so a crowd causes one read, not many.
func (f *feed) entries(ctx context.Context) []entry {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cached != nil && f.now().Sub(f.builtAt) < f.cacheFor {
		return f.cached
	}
	entries := f.noticeEntries()
	entries = append(entries, f.reportEntries(ctx)...)
	if f.statuses != nil {
		statusEntries, err := f.statusEntries()
		if err != nil {
			f.logf("status changes left out of the feed: %s", err.Error())
		}
		entries = append(entries, statusEntries...)
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if !entries[i].time.Equal(entries[j].time) {
			return entries[i].time.After(entries[j].time)
		}
		return entries[i].id < entries[j].id
	})
	if len(entries) > f.config.Limit {
		entries = entries[:f.config.Limit]
	}
	f.cached, f.builtAt = entries, f.now()
	return entries
}

// noticeEntries turns notices into entries. A notice has no ID of its own, so
// the ID comes from its content: a reader sees an edited notice as a new entry.
func (f *feed) noticeEntries() []entry {
	notices := f.notices()
	entries := make([]entry, 0, len(notices))
	for _, notice := range notices {
		at := notice.Timestamp.UTC()
		sum := sha256.Sum256([]byte(at.Format(time.RFC3339Nano) + "\x00" + notice.Type + "\x00" + notice.Message))
		entries = append(entries, entry{
			id:        f.tag(at, "notice:"+hex.EncodeToString(sum[:8])),
			title:     titleOf(notice),
			content:   notice.Message,
			link:      f.base + linkOf(notice.Message),
			published: at,
			time:      at,
		})
	}
	return entries
}

// tag makes an RFC 4151 tag URI, which stays the same wherever the feed is read.
func (f *feed) tag(day time.Time, specific string) string {
	return "tag:" + f.host + "," + day.UTC().Format("2006-01-02") + ":" + specific
}

// reportLink finds the link a notice from the incidents plugin ends with. It
// must be the very end, because a title or message earlier in the notice is
// stored text that could imitate one. Only an ID of the form that plugin makes
// is accepted.
var reportLink = regexp.MustCompile(`\]\((/reports/[0-9a-f]{32})\)\s*$`)

// linkOf returns the path an entry should link to: the report page when the
// notice comes from a report, and the status page otherwise.
func linkOf(message string) string {
	if match := reportLink.FindStringSubmatch(message); match != nil {
		return match[1]
	}
	return "/"
}

// updated is when the feed last changed. Formats require it even when empty.
func (f *feed) updated(entries []entry) time.Time {
	if len(entries) > 0 {
		return entries[0].time
	}
	return f.started
}

// titleOf builds a title, because a notice has only a message.
func titleOf(notice *announcement.Announcement) string {
	line, _, _ := strings.Cut(strings.TrimSpace(notice.Message), "\n")
	line = shortTitle(strings.TrimRight(strings.TrimLeft(strings.TrimSpace(line), "#* "), "* "))
	if label := labelOf(notice.Type); label != "" {
		return label + ": " + line
	}
	return line
}

// shortTitle trims text and cuts it to maxTitleLength characters.
func shortTitle(text string) string {
	text = strings.TrimSpace(text)
	if runes := []rune(text); len(runes) > maxTitleLength {
		text = strings.TrimSpace(string(runes[:maxTitleLength-1])) + "…"
	}
	return text
}

func labelOf(noticeType string) string {
	switch noticeType {
	case announcement.TypeOutage:
		return "Outage"
	case announcement.TypeWarning:
		return "Warning"
	case announcement.TypeInformation:
		return "Information"
	case announcement.TypeOperational:
		return "Resolved"
	}
	return ""
}

func (f *feed) write(w http.ResponseWriter, contentType string, body []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(body)
}
