package feeds

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"github.com/TwiN/gatus/v5/storage/store"
	"github.com/TwiN/gatus/v5/storage/store/common/paging"
)

const (
	// reportReadTimeout bounds one read of the reports.
	reportReadTimeout = 3 * time.Second
	// maxEventsPerEndpoint bounds the stored events read for one endpoint.
	maxEventsPerEndpoint = 100
	// stampLayout is how a status change gives its time. Times are always UTC.
	stampLayout = "15:04 UTC on 2 Jan 2006"
)

// reportLister is the part of record.Service the feed reads.
type reportLister interface {
	ListReports(ctx context.Context, filter record.ReportFilter) ([]*record.Report, error)
}

// statusReader returns what the status page lists, each with its latest events.
type statusReader func() ([]*endpoint.Status, error)

// storedStatuses reads Gatus's own store, the same way the status page's list
// does, so the feed names exactly the endpoints the page shows. One more event
// than the limit is read, so the oldest change kept can tell what came before.
func storedStatuses(limit int) statusReader {
	events := min(limit+1, maxEventsPerEndpoint)
	return func() ([]*endpoint.Status, error) {
		return store.Get().GetAllEndpointStatuses(paging.NewEndpointStatusParams().WithEvents(1, events))
	}
}

// reportEntries reads the newest published reports, resolved or not, however
// old. When the read fails it serves the last good list, and logs only when
// reads start and stop failing.
func (f *feed) reportEntries(ctx context.Context) []entry {
	if f.reports == nil {
		return nil
	}
	reading, cancel := context.WithTimeout(ctx, reportReadTimeout)
	defer cancel()
	reports, err := f.reports.ListReports(reading, record.ReportFilter{PublishedOnly: true, Limit: f.config.Limit})
	if err != nil {
		if !f.failing {
			f.logf("reports in the feed are stale, serving the last good copy: %s", err.Error())
		}
		f.failing = true
		return f.reported
	}
	if f.failing {
		f.logf("reports in the feed are current again")
	}
	f.failing = false
	entries := make([]entry, 0, len(reports))
	for _, report := range reports {
		if e, ok := f.reportEntry(report); ok {
			entries = append(entries, e)
		}
	}
	f.reported = entries
	return entries
}

// reportEntry makes one entry per report. Its ID comes from the report's ID, so
// an edited or resolved report changes its entry rather than adding one.
func (f *feed) reportEntry(report *record.Report) (entry, bool) {
	latest := report.LatestUpdate()
	if latest == nil || !record.ValidID(report.ID) || !report.Published() {
		return entry{}, false
	}
	changed := latest.At
	for _, at := range []*time.Time{&report.UpdatedAt, report.ResolvedAt} {
		if at != nil && at.After(changed) {
			changed = *at
		}
	}
	return entry{
		id:        f.tag(report.CreatedAt, "report:"+report.ID),
		title:     capitalized(string(report.Stage)) + ": " + shortTitle(report.Title),
		content:   latest.Message,
		link:      f.base + "/reports/" + report.ID,
		published: report.PublishedAt.UTC(),
		time:      changed.UTC(),
	}, true
}

// statusEntries makes an entry when an endpoint starts failing its checks, and
// when it passes them again after failing. The first result after Gatus starts
// is not a change, so it makes none. Entries hold only the endpoint's name and
// the time: never its address, conditions or errors, which the page can hide.
func (f *feed) statusEntries() ([]entry, error) {
	statuses, err := f.statuses()
	if err != nil {
		return nil, err
	}
	var entries []entry
	for _, status := range statuses {
		name := shortTitle(status.Name)
		if name == "" || status.Key == "" {
			continue
		}
		key := url.PathEscape(status.Key)
		for i, event := range status.Events {
			var title, text, kind string
			switch {
			case event.Type == endpoint.EventUnhealthy:
				title, text, kind = name+" is down", name+" started failing its checks at ", "down"
			case event.Type == endpoint.EventHealthy && i > 0 && status.Events[i-1].Type == endpoint.EventUnhealthy:
				title, text, kind = name+" is working again", name+" passed its checks again at ", "up"
			default:
				continue
			}
			at := event.Timestamp.UTC()
			entries = append(entries, entry{
				id:        f.tag(at, "status:"+key+":"+strconv.FormatInt(at.Unix(), 10)+":"+kind),
				title:     title,
				content:   text + at.Format(stampLayout) + ".",
				link:      f.base + "/endpoints/" + key,
				published: at,
				time:      at,
			})
		}
	}
	return entries, nil
}

// capitalized gives a stage as a label: "resolved" becomes "Resolved".
func capitalized(word string) string {
	if word == "" {
		return "Update"
	}
	return strings.ToUpper(word[:1]) + word[1:]
}
