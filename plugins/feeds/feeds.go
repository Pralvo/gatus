// Package feeds publishes status notices as Atom, RSS and JSON feeds, so that
// people can follow them without an account. It stores nothing.
package feeds

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/notice"
)

// maxTitleLength keeps a title readable in a feed reader. It counts characters.
const maxTitleLength = 80

// Config is the plugin's config: block.
type Config struct {
	// BaseURL is the public address of the status page. It is required because
	// the service cannot learn its public name safely from a request header.
	BaseURL string `yaml:"base-url"`
	// Title names the feed. It defaults to the page title.
	Title string `yaml:"title"`
	// Limit is the most entries a feed returns.
	Limit int `yaml:"limit"`
}

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "feeds",
	Description: "Atom, RSS and JSON feeds of status notices.",
	Needs:       []plugin.Key{plugin.CoreConfig},
	Start: func(ctx *plugin.Context) error {
		cfg := Config{Limit: 50}
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		base, err := url.Parse(cfg.BaseURL)
		if err != nil || (base.Scheme != "https" && base.Scheme != "http") || base.Host == "" {
			return errors.New("base-url must be an absolute http or https address")
		}
		if cfg.Limit < 1 {
			return errors.New("limit must be at least 1")
		}
		gatusConfig := plugin.Get[*config.Config](ctx, plugin.CoreConfig)
		if cfg.Title == "" && gatusConfig.UI != nil {
			cfg.Title = gatusConfig.UI.Title
		}
		f := &feed{
			config:  cfg,
			base:    strings.TrimRight(base.String(), "/"),
			host:    base.Hostname(),
			started: time.Now().UTC(),
			notices: func() []*announcement.Announcement { return notice.All(gatusConfig.Announcements) },
		}
		ctx.HandleFunc("GET /feed/atom.xml", f.atom)
		ctx.HandleFunc("GET /feed/rss.xml", f.rss)
		ctx.HandleFunc("GET /feed/feed.json", f.json)
		return nil
	},
}

// feed renders one list of notices in several formats.
type feed struct {
	config  Config
	base    string
	host    string
	started time.Time
	notices func() []*announcement.Announcement
}

// entry is a notice in the shape every format needs.
type entry struct {
	id      string
	title   string
	content string
	time    time.Time
}

// entries returns the newest notices first. A notice has no ID of its own, so
// the ID comes from its content: a reader sees an edited notice as a new entry.
func (f *feed) entries() []entry {
	notices := f.notices()
	entries := make([]entry, 0, len(notices))
	for _, notice := range notices {
		sum := sha256.Sum256([]byte(notice.Timestamp.UTC().Format(time.RFC3339Nano) + "\x00" + notice.Type + "\x00" + notice.Message))
		entries = append(entries, entry{
			id:      "tag:" + f.host + "," + notice.Timestamp.UTC().Format("2006-01-02") + ":notice:" + hex.EncodeToString(sum[:8]),
			title:   titleOf(notice),
			content: notice.Message,
			time:    notice.Timestamp.UTC(),
		})
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].time.After(entries[j].time) })
	if len(entries) > f.config.Limit {
		entries = entries[:f.config.Limit]
	}
	return entries
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
	line = strings.TrimSpace(strings.TrimLeft(line, "#* "))
	if runes := []rune(line); len(runes) > maxTitleLength {
		line = strings.TrimSpace(string(runes[:maxTitleLength-1])) + "…"
	}
	if label := labelOf(notice.Type); label != "" {
		return label + ": " + line
	}
	return line
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
