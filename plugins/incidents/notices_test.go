package incidents

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"github.com/TwiN/gatus/v5/plugins/incidents/sqlstore"
)

var moment = time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)

func report(stage record.Stage, impacts ...record.Impact) *record.Report {
	r := &record.Report{ID: record.NewID(), Title: "Slow reads", Stage: stage, Updates: []record.ReportUpdate{{Seq: 1, At: moment, Stage: stage, Message: "Latest words."}}}
	for _, impact := range impacts {
		r.Endpoints = append(r.Endpoints, record.AffectedEndpoint{Key: "k", Impact: impact})
	}
	return r
}

func TestNoticeTypeFollowsStageAndWorstImpact(t *testing.T) {
	cases := []struct {
		stage   record.Stage
		impacts []record.Impact
		want    string
	}{
		{record.StageInvestigating, []record.Impact{record.ImpactMajor}, announcement.TypeOutage},
		{record.StageIdentified, []record.Impact{record.ImpactDegraded, record.ImpactMajor}, announcement.TypeOutage},
		{record.StageInvestigating, []record.Impact{record.ImpactPartial}, announcement.TypeWarning},
		{record.StageIdentified, []record.Impact{record.ImpactDegraded}, announcement.TypeWarning},
		{record.StageIdentified, []record.Impact{record.ImpactMaintenance}, announcement.TypeInformation},
		{record.StageInvestigating, nil, announcement.TypeWarning},
		{record.StageMonitoring, []record.Impact{record.ImpactMajor}, announcement.TypeWarning},
		{record.StageMonitoring, []record.Impact{record.ImpactPartial}, announcement.TypeInformation},
		{record.StageMonitoring, nil, announcement.TypeInformation},
		{record.StageMonitoring, []record.Impact{record.ImpactMaintenance}, announcement.TypeInformation},
		{record.StageResolved, []record.Impact{record.ImpactMajor}, announcement.TypeOperational},
	}
	for _, c := range cases {
		r := report(c.stage, c.impacts...)
		got, ok := noticeFor(r)
		if !ok || got.Type != c.want {
			t.Errorf("%s %v: got %q", c.stage, c.impacts, got.Type)
		}
	}
}

func TestResolvedNoticesAreArchivedAtTheirResolvedTime(t *testing.T) {
	resolvedAt := moment.Add(time.Hour)
	r := report(record.StageResolved)
	r.ResolvedAt = &resolvedAt
	got, ok := noticeFor(r)
	if !ok || !got.Archived || !got.Timestamp.Equal(resolvedAt) {
		t.Fatalf("notice: %+v", got)
	}
	if active, _ := noticeFor(report(record.StageMonitoring)); active.Archived {
		t.Fatal("an unresolved report was archived")
	}
}

func TestNoticeSkipsARowItCannotTrust(t *testing.T) {
	broken := report(record.StageIdentified)
	broken.ID = "x)[evil](https://example.com"
	if _, ok := noticeFor(broken); ok {
		t.Fatal("a malformed ID reached a link")
	}
	empty := report(record.StageIdentified)
	empty.Updates = nil
	if _, ok := noticeFor(empty); ok {
		t.Fatal("a report with no update made a notice")
	}
}

var unescaped = regexp.MustCompile("(^|[^\\\\])[<>\\[\\]!`*_&~]")

func TestHostileTextCannotBecomeMarkup(t *testing.T) {
	r := report(record.StageIdentified)
	r.Title = `<img src=x onerror=alert(1)> ** [a](javascript:alert(1)) ![t](https://tracker.example/p.png) \`
	r.Updates[0].Message = "<script>alert(1)</script>\n`code` _x_ ~y~ &#60; ![i](https://tracker.example/q.png)"
	got, ok := noticeFor(r)
	if !ok {
		t.Fatal("no notice")
	}
	// Only the notice's own frame may carry active Markdown.
	body := strings.TrimPrefix(got.Message, "**Identified: ")
	body = body[:strings.LastIndex(body, "[Read the report]")]
	body = strings.Replace(body, "**\n\n", "\n\n", 1)
	body = strings.ReplaceAll(body, `\\`, "")
	if found := unescaped.FindString(body); found != "" {
		t.Fatalf("unescaped %q in %q", found, body)
	}
	if !strings.Contains(got.Message, `\<script\>`) || !strings.Contains(got.Message, `\!\[i\]`) {
		t.Fatalf("message: %s", got.Message)
	}
}

// scriptedLister returns what a test sets, and can block until its context ends.
type scriptedLister struct {
	reports atomic.Pointer[[]*record.Report]
	err     atomic.Pointer[error]
	block   atomic.Bool
	calls   atomic.Int32
}

func (s *scriptedLister) ListReports(ctx context.Context, _ record.ReportFilter) ([]*record.Report, error) {
	s.calls.Add(1)
	if s.block.Load() {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	if err := s.err.Load(); err != nil {
		return nil, *err
	}
	return *s.reports.Load(), nil
}

func quiet(string, ...any) {}

func TestCacheKeepsTheLastGoodCopyWhenReadsFail(t *testing.T) {
	lister := &scriptedLister{}
	lister.reports.Store(&[]*record.Report{report(record.StageIdentified)})
	cache := newNoticeCache(lister, time.Now, quiet)
	if got := cache.notices(); got != nil {
		t.Fatalf("notices before the first read: %+v", got)
	}
	if err := cache.refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("connection refused")
	lister.err.Store(&failure)
	if err := cache.refresh(t.Context()); !errors.Is(err, failure) {
		t.Fatalf("refresh: %v", err)
	}
	got := cache.notices()
	if len(got) != 1 || !strings.Contains(got[0].Message, "Latest words.") {
		t.Fatalf("the last good copy was lost: %+v", got)
	}
}

func TestCacheLogsAnOutageOnce(t *testing.T) {
	lister := &scriptedLister{}
	lister.reports.Store(&[]*record.Report{})
	var lines []string
	cache := newNoticeCache(lister, time.Now, func(format string, _ ...any) { lines = append(lines, format) })
	failure := errors.New("down")
	lister.err.Store(&failure)
	for range 3 {
		_ = cache.refresh(t.Context())
	}
	lister.err.Store(nil)
	_ = cache.refresh(t.Context())
	if len(lines) != 2 {
		t.Fatalf("log lines: %q", lines)
	}
}

func TestSlowDatabaseNeverHoldsUpTheSource(t *testing.T) {
	lister := &scriptedLister{}
	lister.reports.Store(&[]*record.Report{report(record.StageIdentified)})
	cache := newNoticeCache(lister, time.Now, quiet)
	if err := cache.refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	lister.block.Store(true)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	stopped := make(chan struct{})
	go func() { cache.run(ctx); close(stopped) }()
	cache.wake()
	for lister.calls.Load() < 2 {
		time.Sleep(time.Millisecond)
	}
	// The refresh is now stuck in the database.
	started := time.Now()
	got := cache.notices()
	if elapsed := time.Since(started); elapsed > 100*time.Millisecond {
		t.Fatalf("the source took %s", elapsed)
	}
	if len(got) != 1 {
		t.Fatalf("notices: %+v", got)
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("the job did not stop with its context")
	}
}

func TestRefreshIsBoundedWhenTheContextNeverEnds(t *testing.T) {
	lister := &scriptedLister{}
	lister.block.Store(true)
	cache := newNoticeCache(lister, time.Now, quiet)
	done := make(chan error, 1)
	go func() { done <- cache.refresh(context.Background()) }()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("refresh: %v", err)
		}
	case <-time.After(2 * noticeReadTimeout):
		t.Fatal("refresh had no deadline")
	}
}

func TestCallersCannotChangeTheCache(t *testing.T) {
	lister := &scriptedLister{}
	lister.reports.Store(&[]*record.Report{report(record.StageIdentified)})
	cache := newNoticeCache(lister, time.Now, quiet)
	if err := cache.refresh(t.Context()); err != nil {
		t.Fatal(err)
	}
	cache.notices()[0].Message = "changed"
	if cache.notices()[0].Message == "changed" {
		t.Fatal("a caller reached the cached notice")
	}
}

func TestRealDatabaseDownKeepsServingAndArchiveDropsOld(t *testing.T) {
	db := databasetest.SQLite(t)
	store := sqlstore.New(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	clock := moment
	manager := record.NewManager(store, func() time.Time { return clock }, func(string, any) {}, func(string) bool { return true })
	ctx := t.Context()
	resolved, err := manager.CreateReport(ctx, "alice", record.NewReport{Title: "Old", Stage: record.StageResolved, Message: "Done.", Published: true})
	if err != nil {
		t.Fatal(err)
	}
	live, err := manager.CreateReport(ctx, "alice", record.NewReport{Title: "Live", Stage: record.StageIdentified, Message: "Working.", Published: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.CreateReport(ctx, "alice", record.NewReport{Title: "Draft", Stage: record.StageIdentified, Message: "Secret."}); err != nil {
		t.Fatal(err)
	}
	cache := newNoticeCache(manager, func() time.Time { return clock.Add(archiveFor - time.Minute) }, quiet)
	if err := cache.refresh(ctx); err != nil {
		t.Fatal(err)
	}
	if got := cache.notices(); len(got) != 2 {
		t.Fatalf("within the archive window: %+v", got)
	}
	cache.now = func() time.Time { return clock.Add(archiveFor + time.Minute) }
	if err := cache.refresh(ctx); err != nil {
		t.Fatal(err)
	}
	got := cache.notices()
	if len(got) != 1 || !strings.Contains(got[0].Message, live.ID) || strings.Contains(got[0].Message, resolved.ID) {
		t.Fatalf("past the archive window: %+v", got)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if err := cache.refresh(ctx); err == nil {
		t.Fatal("expected a read on a closed database to fail")
	}
	if got := cache.notices(); len(got) != 1 {
		t.Fatalf("the page lost its notice with the database: %+v", got)
	}
}
