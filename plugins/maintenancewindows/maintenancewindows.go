// Package maintenancewindows adds one-off, dated maintenance. Gatus's own
// maintenance repeats on weekdays and only silences alerts. A window here has
// real dates, can silence alerts for chosen endpoints, and appears on the status
// page: upcoming, then in progress, then finished.
package maintenancewindows

import (
	"fmt"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/config/maintenance"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/notice"
)

// timeLayout is how windows are shown on the page. Times are always UTC.
const timeLayout = "2 Jan 2006 15:04 UTC"

// Window is one planned maintenance period.
type Window struct {
	Title string    `yaml:"title"`
	Start time.Time `yaml:"start"`
	End   time.Time `yaml:"end"`
	// Details is extra text for the notice.
	Details string `yaml:"details"`
	// Endpoints limits the window to these "group/name" or "name" endpoints.
	// Empty means every endpoint.
	Endpoints []string `yaml:"endpoints"`
	// SilenceAlerts stops alerts for the window's endpoints. It defaults to true.
	SilenceAlerts *bool `yaml:"silence-alerts"`
	// AnnounceBefore is how long before Start the notice appears.
	AnnounceBefore time.Duration `yaml:"announce-before"`

	keys map[string]bool
}

// Config is the plugin's config: block.
type Config struct {
	Windows []*Window `yaml:"windows"`
}

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "maintenance-windows",
	Description: "Dated maintenance shown on the status page, with optional alert silencing.",
	Needs:       []plugin.Key{plugin.CoreConfig},
	Start: func(ctx *plugin.Context) error {
		var cfg Config
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		if err := validate(cfg.Windows, plugin.Get[*config.Config](ctx, plugin.CoreConfig)); err != nil {
			return err
		}
		schedule := &schedule{windows: cfg.Windows, now: time.Now}
		ctx.Defer(notice.AddSource(schedule.notices))
		maintenance.SetScheduleCheck(schedule.silenced)
		ctx.Defer(func() error { maintenance.SetScheduleCheck(nil); return nil })
		return nil
	},
}

func validate(windows []*Window, gatusConfig *config.Config) error {
	known := map[string]string{}
	for _, ep := range gatusConfig.Endpoints {
		known[ep.Name] = ep.Key()
		known[ep.Group+"/"+ep.Name] = ep.Key()
	}
	for _, ee := range gatusConfig.ExternalEndpoints {
		known[ee.Name] = ee.Key()
		known[ee.Group+"/"+ee.Name] = ee.Key()
	}
	for i, w := range windows {
		if strings.TrimSpace(w.Title) == "" {
			return fmt.Errorf("window %d has no title", i)
		}
		if w.Start.IsZero() || w.End.IsZero() || !w.End.After(w.Start) {
			return fmt.Errorf("window %q needs a start before its end", w.Title)
		}
		w.keys = map[string]bool{}
		for _, name := range w.Endpoints {
			endpointKey, ok := known[name]
			if !ok {
				return fmt.Errorf("window %q names an unknown endpoint: %s", w.Title, name)
			}
			w.keys[endpointKey] = true
		}
	}
	return nil
}

// schedule answers questions about windows at a moment in time.
type schedule struct {
	windows []*Window
	now     func() time.Time
}

// silenced reports whether alerts for an endpoint are off right now.
func (s *schedule) silenced(endpointKey string) bool {
	now := s.now()
	for _, w := range s.windows {
		if w.SilenceAlerts != nil && !*w.SilenceAlerts {
			continue
		}
		if now.Before(w.Start) || !now.Before(w.End) {
			continue
		}
		if len(w.keys) == 0 || w.keys[endpointKey] {
			return true
		}
	}
	return false
}

// notices computes each notice from the clock, so a window moves from upcoming
// to finished on time with nobody touching it.
func (s *schedule) notices() []*announcement.Announcement {
	now := s.now()
	notices := make([]*announcement.Announcement, 0, len(s.windows))
	for _, w := range s.windows {
		switch {
		case now.Before(w.Start.Add(-w.AnnounceBefore)):
		case now.Before(w.Start):
			notices = append(notices, w.notice(w.Start.Add(-w.AnnounceBefore), announcement.TypeInformation, "Scheduled maintenance", false))
		case now.Before(w.End):
			notices = append(notices, w.notice(w.Start, announcement.TypeWarning, "Maintenance in progress", false))
		default:
			notices = append(notices, w.notice(w.End, announcement.TypeOperational, "Maintenance finished", true))
		}
	}
	return notices
}

func (w *Window) notice(at time.Time, kind, label string, archived bool) *announcement.Announcement {
	message := fmt.Sprintf("**%s: %s**\n\n%s to %s", label, w.Title, w.Start.UTC().Format(timeLayout), w.End.UTC().Format(timeLayout))
	if details := strings.TrimSpace(w.Details); details != "" {
		message += "\n\n" + details
	}
	if len(w.Endpoints) > 0 {
		message += "\n\nAffects: " + strings.Join(w.Endpoints, ", ")
	}
	return &announcement.Announcement{Timestamp: at.UTC(), Type: kind, Message: message, Archived: archived}
}
