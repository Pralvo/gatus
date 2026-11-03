package maintenancewindows

import (
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/config/maintenance"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/notice"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
)

var (
	start = time.Date(2026, 12, 6, 2, 0, 0, 0, time.UTC)
	end   = start.Add(time.Hour)
)

func window(endpoints ...string) *Window {
	w := &Window{Title: "Upgrade", Start: start, End: end, AnnounceBefore: 24 * time.Hour, Details: "Reads stay up.", Endpoints: endpoints, keys: map[string]bool{}}
	for _, name := range endpoints {
		w.keys[name] = true
	}
	return w
}

func at(moment time.Time, windows ...*Window) *schedule {
	return &schedule{windows: windows, now: func() time.Time { return moment }}
}

func TestNoticeFollowsTheClock(t *testing.T) {
	cases := []struct {
		name     string
		moment   time.Time
		kind     string
		text     string
		archived bool
		absent   bool
	}{
		{name: "too early", moment: start.Add(-25 * time.Hour), absent: true},
		{name: "announced", moment: start.Add(-time.Hour), kind: announcement.TypeInformation, text: "Scheduled maintenance"},
		{name: "at start", moment: start, kind: announcement.TypeWarning, text: "in progress"},
		{name: "last moment", moment: end.Add(-time.Second), kind: announcement.TypeWarning, text: "in progress"},
		{name: "at end", moment: end, kind: announcement.TypeOperational, text: "finished", archived: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := at(c.moment, window()).notices()
			if c.absent {
				if len(got) != 0 {
					t.Fatalf("unexpected notice: %+v", got[0])
				}
				return
			}
			if len(got) != 1 || got[0].Type != c.kind || !strings.Contains(got[0].Message, c.text) || got[0].Archived != c.archived {
				t.Fatalf("notice: %+v", got)
			}
			if err := got[0].ValidateAndSetDefaults(); err != nil {
				t.Fatalf("not a valid announcement: %v", err)
			}
		})
	}
}

func TestSilencedOnlyInsideWindowAndForChosenEndpoints(t *testing.T) {
	if at(start.Add(-time.Second), window()).silenced("any") {
		t.Fatal("silenced before start")
	}
	if at(end, window()).silenced("any") {
		t.Fatal("silenced at end")
	}
	if !at(start, window()).silenced("any") {
		t.Fatal("an empty endpoint list means every endpoint")
	}
	limited := window("core_db")
	if !at(start, limited).silenced("core_db") || at(start, limited).silenced("core_web") {
		t.Fatal("window ignored its endpoint list")
	}
	off := false
	quiet := window()
	quiet.SilenceAlerts = &off
	if at(start, quiet).silenced("any") {
		t.Fatal("silence-alerts: false was ignored")
	}
}

func coreConfig() map[plugin.Key]any {
	return map[plugin.Key]any{plugin.CoreConfig: &config.Config{Endpoints: []*endpoint.Endpoint{{Group: "core", Name: "db"}}}}
}

func TestPluginWiresNoticesAndSilencingThenRemovesThem(t *testing.T) {
	future := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	later := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	h := plugintest.Start(t, Definition, "windows:\n  - title: Live\n    start: "+future+"\n    end: "+later+"\n    endpoints: [core/db]\n", coreConfig())
	if !maintenance.IsScheduled("core_db") {
		t.Fatal("alerts are not silenced")
	}
	if maintenance.IsScheduled("core_web") {
		t.Fatal("another endpoint was silenced")
	}
	if got := notice.All(nil); len(got) != 1 || !strings.Contains(got[0].Message, "Live") {
		t.Fatalf("notices: %+v", got)
	}
	h.Host.Shutdown()
	if maintenance.IsScheduled("core_db") {
		t.Fatal("silencing survived the plugin")
	}
	if got := notice.All(nil); len(got) != 0 {
		t.Fatalf("notice survived the plugin: %+v", got)
	}
}

func TestBadWindowsAreRefusedByName(t *testing.T) {
	cases := map[string]struct{ config, reason string }{
		"no title":     {"windows:\n  - start: 2026-12-06T02:00:00Z\n    end: 2026-12-06T03:00:00Z\n", "no title"},
		"backwards":    {"windows:\n  - title: x\n    start: 2026-12-06T03:00:00Z\n    end: 2026-12-06T02:00:00Z\n", "start before"},
		"missing end":  {"windows:\n  - title: x\n    start: 2026-12-06T03:00:00Z\n", "start before"},
		"bad endpoint": {"windows:\n  - title: x\n    start: 2026-12-06T02:00:00Z\n    end: 2026-12-06T03:00:00Z\n    endpoints: [ghost]\n", "ghost"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			h := plugintest.Load(t, Definition, c.config, coreConfig())
			if got := h.Host.Statuses()[0]; got.State != plugin.StateFailed || !strings.Contains(got.Reason, c.reason) {
				t.Fatalf("status: %+v", got)
			}
		})
	}
}
