package reportpages

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const hostile = `<script>alert(1)</script>"'&`

var moment = time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)

// fake is a record.Service that only reads. Any other method panics, because the
// pages must never write.
type fake struct {
	record.Service
	reports []*record.Report
	err     error
	filters []record.ReportFilter
	gets    int
}

func (f *fake) GetReport(ctx context.Context, id string) (*record.Report, error) {
	f.gets++
	if err := checkDeadline(ctx); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	for _, r := range f.reports {
		if r.ID == id {
			return r, nil
		}
	}
	return nil, record.ErrNotFound
}

func (f *fake) ListReports(ctx context.Context, filter record.ReportFilter) ([]*record.Report, error) {
	f.filters = append(f.filters, filter)
	if err := checkDeadline(ctx); err != nil {
		return nil, err
	}
	if f.err != nil {
		return nil, f.err
	}
	out := f.reports[min(filter.Offset, len(f.reports)):]
	return out[:min(filter.Limit, len(out))], nil
}

// checkDeadline fails a read that could wait forever on a slow database.
func checkDeadline(ctx context.Context) error {
	deadline, ok := ctx.Deadline()
	if !ok || time.Until(deadline) > readTimeout {
		return errors.New("read has no deadline")
	}
	return nil
}

func published(title string, stage record.Stage, endpoints ...record.AffectedEndpoint) *record.Report {
	at := moment
	r := &record.Report{ID: record.NewID(), Title: title, Stage: stage, Endpoints: endpoints, PublishedAt: &at, CreatedAt: moment, UpdatedAt: moment,
		Updates: []record.ReportUpdate{
			{Seq: 1, At: moment, Stage: record.StageInvestigating, Message: "First words."},
			{Seq: 2, At: moment.Add(90 * time.Minute), Stage: stage, Message: "Latest words.\nSecond line."},
		}}
	if stage == record.StageResolved {
		resolved := moment.Add(2 * time.Hour)
		r.ResolvedAt = &resolved
	}
	return r
}

func provider(service record.Service) plugin.Definition {
	return plugin.Definition{
		Name:     "incidents",
		Provides: []plugin.Key{incidentsKey},
		Start:    func(ctx *plugin.Context) error { ctx.Provide(incidentsKey, service); return nil },
	}
}

func core() map[plugin.Key]any {
	return map[plugin.Key]any{plugin.CoreConfig: &config.Config{
		UI:        &ui.Config{Title: "Example status"},
		Endpoints: []*endpoint.Endpoint{{Group: "core", Name: "database"}},
	}}
}

func start(t *testing.T, service *fake, configYAML string) *plugintest.Harness {
	t.Helper()
	return plugintest.Start(t, Definition, configYAML, core(), provider(service))
}

func TestStoredTextIsEscapedEverywhere(t *testing.T) {
	report := published(hostile, record.StageIdentified, record.AffectedEndpoint{Key: hostile, Impact: record.ImpactMajor})
	report.Updates[1].Message = hostile
	h := start(t, &fake{reports: []*record.Report{report}}, "")
	for _, path := range []string{"/reports", "/reports/" + report.ID} {
		response := h.Get(path)
		body := response.Body.String()
		if response.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", path, response.Code, body)
		}
		if strings.Contains(body, "<script") || strings.Contains(body, `"'&<`) {
			t.Fatalf("%s: stored text reached the page as markup:\n%s", path, body)
		}
		if !strings.Contains(body, "&lt;script&gt;alert(1)&lt;/script&gt;") {
			t.Fatalf("%s: escaped text is missing:\n%s", path, body)
		}
	}
}

func TestReportPageShowsUpdatesNewestFirstWithEndpoints(t *testing.T) {
	report := published("Slow reads", record.StageMonitoring,
		record.AffectedEndpoint{Key: "core_database", Impact: record.ImpactPartial},
		record.AffectedEndpoint{Key: "gone_endpoint", Impact: record.ImpactMaintenance})
	h := start(t, &fake{reports: []*record.Report{report}}, "")
	response := h.Get("/reports/" + report.ID)
	body := response.Body.String()
	for _, want := range []string{
		"<title>Slow reads · Example status</title>", "core/database", "Partial outage", "gone_endpoint", "Maintenance",
		`<time datetime="2026-11-03T11:30:00Z">3 Nov 2026, 11:30 UTC</time>`, "Latest words.\nSecond line.",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q:\n%s", want, body)
		}
	}
	if strings.Index(body, "Latest words.") > strings.Index(body, "First words.") {
		t.Fatal("updates are not newest first")
	}
	if got := response.Header().Get("Cache-Control"); got != "public, max-age=30" {
		t.Fatalf("Cache-Control: %q", got)
	}
}

func TestDraftsAndUnknownIDsLookTheSame(t *testing.T) {
	draft := published("Secret draft", record.StageIdentified)
	draft.PublishedAt = nil
	service := &fake{reports: []*record.Report{draft}}
	h := start(t, service, "")
	for _, path := range []string{"/reports/" + draft.ID, "/reports/" + record.NewID()} {
		response := h.Get(path)
		if response.Code != http.StatusNotFound || strings.Contains(response.Body.String(), "Secret draft") {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body)
		}
	}
	before := service.gets
	if response := h.Get("/reports/not-an-id"); response.Code != http.StatusNotFound || service.gets != before {
		t.Fatalf("a malformed ID reached the database: %d", response.Code)
	}
	listed := start(t, &fake{reports: []*record.Report{draft}}, "")
	if body := listed.Get("/reports").Body.String(); strings.Contains(body, "Secret draft") {
		t.Fatal("a draft reached the list")
	}
}

func TestListPutsActiveFirstAndPages(t *testing.T) {
	service := &fake{reports: []*record.Report{
		published("Active one", record.StageInvestigating),
		published("Old one", record.StageResolved),
		published("Older one", record.StageResolved),
	}}
	h := start(t, service, "page-size: 2")
	body := h.Get("/reports").Body.String()
	active, past := strings.Index(body, "<h2>Active</h2>"), strings.Index(body, "<h2>Past</h2>")
	if active < 0 || past < active || strings.Index(body, "Active one") > past || strings.Index(body, "Old one") < past {
		t.Fatalf("order:\n%s", body)
	}
	if !strings.Contains(body, `href="/reports?page=2"`) || strings.Contains(body, "Older one") {
		t.Fatalf("first page:\n%s", body)
	}
	if got := service.filters[0]; !got.PublishedOnly || got.Limit != 3 || got.Offset != 0 {
		t.Fatalf("filter: %+v", got)
	}
	second := h.Get("/reports?page=2").Body.String()
	if !strings.Contains(second, "Older one") || !strings.Contains(second, `href="/reports?page=1"`) || strings.Contains(second, "page=3") {
		t.Fatalf("second page:\n%s", second)
	}
	for _, page := range []string{"3", "0", "-1", "01", "x", "1001"} {
		if code := h.Get("/reports?page=" + page).Code; code != http.StatusNotFound {
			t.Fatalf("page %s: %d", page, code)
		}
	}
}

func TestEmptyList(t *testing.T) {
	h := start(t, &fake{}, "")
	if body := h.Get("/reports").Body.String(); !strings.Contains(body, "No reports have been published.") {
		t.Fatal(body)
	}
}

func TestDatabaseFailureGivesAPlain503(t *testing.T) {
	cases := map[string]*plugintest.Harness{
		"read fails":       start(t, &fake{err: errors.New("connection refused")}, ""),
		"incidents absent": plugintest.Start(t, Definition, "", core()),
	}
	for name, h := range cases {
		for _, path := range []string{"/reports", "/reports/" + record.NewID()} {
			response := h.Get(path)
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "Reports are unavailable") {
				t.Fatalf("%s %s: %d %s", name, path, response.Code, response.Body)
			}
			if response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Retry-After") == "" {
				t.Fatalf("%s %s: headers %v", name, path, response.Header())
			}
			if strings.Contains(response.Body.String(), "connection refused") {
				t.Fatalf("%s: the error reached the reader", name)
			}
		}
	}
}

func TestPolicyAllowsOnlyTheInlineStyle(t *testing.T) {
	report := published("Slow reads", record.StageIdentified)
	h := start(t, &fake{reports: []*record.Report{report}}, "")
	for _, path := range []string{"/reports", "/reports/" + report.ID, "/reports/x"} {
		response := h.Get(path)
		body := response.Body.String()
		_, rest, _ := strings.Cut(body, "<style>")
		style, _, found := strings.Cut(rest, "</style>")
		if !found {
			t.Fatalf("%s: no style", path)
		}
		sum := sha256.Sum256([]byte(style))
		policy := response.Header().Get("Content-Security-Policy")
		if !strings.Contains(policy, "style-src 'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'") ||
			!strings.HasPrefix(policy, "default-src 'none'") || strings.Contains(policy, "script") {
			t.Fatalf("%s: policy %q does not match the style", path, policy)
		}
		if strings.Contains(body, "<script") {
			t.Fatalf("%s: the page has a script", path)
		}
		if response.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(response.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("%s: headers %v", path, response.Header())
		}
	}
}

func TestBadConfigFailsByName(t *testing.T) {
	for _, configYAML := range []string{"page-size: 0", "page-size: 200", "pagesize: 5"} {
		h := plugintest.Load(t, Definition, configYAML, core())
		if got := h.Host.Statuses()[0]; got.State != plugin.StateFailed {
			t.Fatalf("%q: %+v", configYAML, got)
		}
	}
}
