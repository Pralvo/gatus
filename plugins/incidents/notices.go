package incidents

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const (
	// noticeRefresh is how often the notice copy is rebuilt. A write through this
	// plugin rebuilds it at once, so this only matters after a failure.
	noticeRefresh = 15 * time.Second
	// noticeReadTimeout bounds one rebuild.
	noticeReadTimeout = 3 * time.Second
	// archiveFor is how long a resolved report stays in the past notices.
	archiveFor = 30 * 24 * time.Hour
)

// reportLister is the part of record.Service the notices read.
type reportLister interface {
	ListReports(ctx context.Context, filter record.ReportFilter) ([]*record.Report, error)
}

// noticeCache holds a copy of the notices for the status page. The page reads
// only the copy, and a job refreshes it, so a slow or dead database can never
// hold up the page. After a failure the last good copy keeps being served.
type noticeCache struct {
	reports reportLister
	now     func() time.Time
	logf    func(format string, args ...any)
	current atomic.Pointer[[]announcement.Announcement]
	wakeup  chan struct{}
	failing bool // used only by the goroutine running refresh
}

func newNoticeCache(reports reportLister, now func() time.Time, logf func(format string, args ...any)) *noticeCache {
	return &noticeCache{reports: reports, now: now, logf: logf, wakeup: make(chan struct{}, 1)}
}

// notices is the notice source. It does no I/O and takes no lock. Each caller gets
// its own copies, so nothing outside can change the cache.
func (c *noticeCache) notices() []*announcement.Announcement {
	current := c.current.Load()
	if current == nil {
		return nil
	}
	out := make([]*announcement.Announcement, len(*current))
	for i := range *current {
		copied := (*current)[i]
		out[i] = &copied
	}
	return out
}

// wake asks for a refresh soon. It never blocks, because it runs on the writer's
// goroutine.
func (c *noticeCache) wake() {
	select {
	case c.wakeup <- struct{}{}:
	default:
	}
}

// run refreshes the cache until ctx ends.
func (c *noticeCache) run(ctx context.Context) {
	ticker := time.NewTicker(noticeRefresh)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-c.wakeup:
		}
		_ = c.refresh(ctx)
	}
}

// refresh replaces the copy, or leaves it alone if the read fails. It logs when
// reads start and stop failing rather than on every attempt.
func (c *noticeCache) refresh(ctx context.Context) error {
	reading, cancel := context.WithTimeout(ctx, noticeReadTimeout)
	defer cancel()
	reports, err := c.reports.ListReports(reading, record.ReportFilter{
		PublishedOnly: true,
		ResolvedSince: c.now().Add(-archiveFor),
		Limit:         record.MaxLimit,
	})
	if err != nil {
		if !c.failing {
			c.logf("notices are stale, serving the last good copy: %s", err.Error())
		}
		c.failing = true
		return err
	}
	if c.failing {
		c.logf("notices are current again")
	}
	c.failing = false
	notices := make([]announcement.Announcement, 0, len(reports))
	for _, report := range reports {
		if notice, ok := noticeFor(report); ok {
			notices = append(notices, notice)
		}
	}
	c.current.Store(&notices)
	return nil
}

// noticeFor turns a report into a notice. It skips a row that could not have come
// from this plugin, since the link is built from the ID.
func noticeFor(report *record.Report) (announcement.Announcement, bool) {
	latest := report.LatestUpdate()
	if latest == nil || !record.ValidID(report.ID) {
		return announcement.Announcement{}, false
	}
	message := fmt.Sprintf("**%s: %s**\n\n%s\n\n[Read the report](/reports/%s)",
		stageLabel(report.Stage), plainMarkdown(report.Title), plainMarkdown(latest.Message), report.ID)
	notice := announcement.Announcement{Timestamp: latest.At, Type: noticeType(report.Stage, report.WorstImpact()), Message: message}
	if report.Stage == record.StageResolved {
		notice.Archived = true
		if report.ResolvedAt != nil {
			notice.Timestamp = *report.ResolvedAt
		}
	}
	return notice, true
}

func stageLabel(stage record.Stage) string {
	switch stage {
	case record.StageInvestigating:
		return "Investigating"
	case record.StageIdentified:
		return "Identified"
	case record.StageMonitoring:
		return "Monitoring"
	case record.StageResolved:
		return "Resolved"
	default:
		return "Update"
	}
}

// noticeType picks how alarming a notice looks. A report that names no endpoint
// has an unknown reach, so it counts as a warning until it is being monitored.
// Once a fix is being monitored, a notice looks one step calmer.
func noticeType(stage record.Stage, worst record.Impact) string {
	if stage == record.StageResolved {
		return announcement.TypeOperational
	}
	kind := announcement.TypeWarning
	switch worst {
	case record.ImpactMajor:
		kind = announcement.TypeOutage
	case record.ImpactMaintenance:
		kind = announcement.TypeInformation
	}
	if stage == record.StageMonitoring {
		switch kind {
		case announcement.TypeOutage:
			return announcement.TypeWarning
		case announcement.TypeWarning:
			return announcement.TypeInformation
		}
	}
	return kind
}

var markdownEscaper = strings.NewReplacer(
	`\`, `\\`, "`", "\\`", `*`, `\*`, `_`, `\_`, `~`, `\~`, `[`, `\[`, `]`, `\]`,
	`!`, `\!`, `<`, `\<`, `>`, `\>`, `&`, `\&`,
)

// plainMarkdown makes stored text render as the same text, so a report cannot add
// HTML, a disguised link or a remote image to the page. The page sanitises its
// Markdown too, and this means notices stay safe for any other reader. A bare URL
// can still become a link in a Markdown renderer.
func plainMarkdown(text string) string { return markdownEscaper.Replace(text) }
