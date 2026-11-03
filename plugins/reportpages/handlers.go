package reportpages

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const (
	// readTimeout bounds the database read behind one page, so a slow database
	// gives a quick 503 rather than a hanging page.
	readTimeout = 3 * time.Second
	// maxPage stops a crawler from asking the database for absurd offsets.
	maxPage = 1000
	// cacheFor is short, so a new update reaches readers quickly.
	cacheFor = "public, max-age=30"
	// retryAfter is when a reader might try again after a 503, in seconds.
	retryAfter = "30"
)

// reportReader is the part of record.Service the pages read.
type reportReader interface {
	GetReport(ctx context.Context, id string) (*record.Report, error)
	ListReports(ctx context.Context, filter record.ReportFilter) ([]*record.Report, error)
}

// pages serves the routes. A nil reports means the incidents plugin is not
// running, and every page that needs it answers 503.
type pages struct {
	reports  reportReader
	view     *renderer
	names    map[string]string
	pageSize int
	logf     func(format string, args ...any)
	failing  atomic.Bool
}

func newPages(reports reportReader, cfg Config, names map[string]string, logf func(format string, args ...any)) (*pages, error) {
	view, err := newRenderer(cfg.Title)
	if err != nil {
		return nil, err
	}
	return &pages{reports: reports, view: view, names: names, pageSize: cfg.PageSize, logf: logf}, nil
}

func (p *pages) register(add func(pattern string, handler http.HandlerFunc)) {
	add("GET /reports", p.list)
	add("GET /reports/{id}", p.show)
	add("GET /api/v1/reports", p.apiList)
	add("GET /api/v1/reports/{id}", p.apiShow)
}

// list shows published reports: unresolved ones first, then the most recently
// changed. Drafts never appear.
func (p *pages) list(w http.ResponseWriter, r *http.Request) {
	page, ok := pageNumber(r.URL.Query().Get("page"))
	if !ok {
		p.notFound(w)
		return
	}
	if p.reports == nil {
		p.unavailable(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	reports, err := p.reports.ListReports(ctx, record.ReportFilter{
		PublishedOnly: true,
		Limit:         p.pageSize + 1,
		Offset:        (page - 1) * p.pageSize,
	})
	if err != nil {
		p.readFailed(err)
		p.unavailable(w)
		return
	}
	p.readWorked()
	more := len(reports) > p.pageSize
	if more {
		reports = reports[:p.pageSize]
	}
	if page > 1 && len(reports) == 0 {
		p.notFound(w)
		return
	}
	p.write(w, http.StatusOK, cacheFor, "list", "Reports", listOf(reports, p.names, page, more))
}

// show shows one published report with every update. A draft looks exactly like
// a report that does not exist.
func (p *pages) show(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !record.ValidID(id) {
		p.notFound(w)
		return
	}
	if p.reports == nil {
		p.unavailable(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	report, err := p.reports.GetReport(ctx, id)
	switch {
	case errors.Is(err, record.ErrNotFound):
		p.readWorked()
		p.notFound(w)
		return
	case err != nil:
		p.readFailed(err)
		p.unavailable(w)
		return
	}
	p.readWorked()
	if !report.Published() {
		p.notFound(w)
		return
	}
	view := reportOf(report, p.names)
	p.write(w, http.StatusOK, cacheFor, "report", view.Title, view)
}

// apiList is list as JSON for the page's own scripts. Unlike the HTML list, a page
// past the end is an empty list, and a malformed page number is a 400.
func (p *pages) apiList(w http.ResponseWriter, r *http.Request) {
	page, ok := pageNumber(r.URL.Query().Get("page"))
	if !ok {
		p.writeJSON(w, http.StatusBadRequest, "no-store", apiError{Error: "page must be a whole number from 1 to 1000"})
		return
	}
	if p.reports == nil {
		p.apiUnavailable(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	reports, err := p.reports.ListReports(ctx, record.ReportFilter{
		PublishedOnly: true,
		Limit:         p.pageSize + 1,
		Offset:        (page - 1) * p.pageSize,
	})
	if err != nil {
		p.readFailed(err)
		p.apiUnavailable(w)
		return
	}
	p.readWorked()
	more := len(reports) > p.pageSize
	if more {
		reports = reports[:p.pageSize]
	}
	p.writeJSON(w, http.StatusOK, cacheFor, publicListOf(reports, p.names, page, more))
}

// apiShow is show as JSON. A draft looks exactly like a report that does not exist.
func (p *pages) apiShow(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !record.ValidID(id) {
		p.writeJSON(w, http.StatusNotFound, cacheFor, apiError{Error: "report not found"})
		return
	}
	if p.reports == nil {
		p.apiUnavailable(w)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	report, err := p.reports.GetReport(ctx, id)
	switch {
	case errors.Is(err, record.ErrNotFound):
		p.readWorked()
		p.writeJSON(w, http.StatusNotFound, cacheFor, apiError{Error: "report not found"})
		return
	case err != nil:
		p.readFailed(err)
		p.apiUnavailable(w)
		return
	}
	p.readWorked()
	if !report.Published() {
		p.writeJSON(w, http.StatusNotFound, cacheFor, apiError{Error: "report not found"})
		return
	}
	p.writeJSON(w, http.StatusOK, cacheFor, publicOf(report, p.names))
}

type apiError struct {
	Error string `json:"error"`
}

func (p *pages) apiUnavailable(w http.ResponseWriter) {
	w.Header().Set("Retry-After", retryAfter)
	p.writeJSON(w, http.StatusServiceUnavailable, "no-store", apiError{Error: "reports are unavailable"})
}

// writeJSON encodes the whole body before sending anything, like write.
func (p *pages) writeJSON(w http.ResponseWriter, status int, cacheControl string, body any) {
	out, err := json.Marshal(body)
	if err != nil {
		p.logf("encode report JSON: %s", err.Error())
		status, cacheControl, out = http.StatusInternalServerError, "no-store", []byte(`{"error":"this response could not be made"}`)
	}
	header := w.Header()
	header.Set("Content-Type", "application/json")
	header.Set("Cache-Control", cacheControl)
	header.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(out)
}

func (p *pages) notFound(w http.ResponseWriter) {
	p.write(w, http.StatusNotFound, cacheFor, "message", "Not found", message{
		Heading: "Report not found",
		Text:    "There is no published report at this address.",
	})
}

// unavailable is the page for a missing or failing database. It is never cached,
// so readers see the reports again as soon as they are back.
func (p *pages) unavailable(w http.ResponseWriter) {
	w.Header().Set("Retry-After", retryAfter)
	p.write(w, http.StatusServiceUnavailable, "no-store", "message", "Reports unavailable", message{
		Heading: "Reports are unavailable",
		Text:    "Reports cannot be read right now. The status page is not affected. Please try again in a minute.",
	})
}

// write renders the whole page before sending anything, so a template failure
// never leaves half a page behind.
func (p *pages) write(w http.ResponseWriter, status int, cacheControl, name, title string, body any) {
	var out bytes.Buffer
	if err := p.view.render(&out, name, title, body); err != nil {
		p.logf("render %s: %s", name, err.Error())
		header := w.Header()
		header.Set("Content-Type", "text/plain; charset=utf-8")
		header.Set("Cache-Control", "no-store")
		header.Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("This page could not be shown.\n"))
		return
	}
	header := w.Header()
	header.Set("Content-Type", "text/html; charset=utf-8")
	header.Set("Cache-Control", cacheControl)
	header.Set("Content-Security-Policy", p.view.policy)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Referrer-Policy", "same-origin")
	w.WriteHeader(status)
	_, _ = w.Write(out.Bytes())
}

// readFailed logs when reads start failing, not on every request, so a dead
// database under traffic cannot flood the log.
func (p *pages) readFailed(err error) {
	if !p.failing.Swap(true) {
		p.logf("reports cannot be read, so the pages answer 503: %s", err.Error())
	}
}

func (p *pages) readWorked() {
	if p.failing.Swap(false) {
		p.logf("reports can be read again")
	}
}

// pageNumber reads ?page=. A missing value is the first page. Anything that is
// not a plain number in range is refused.
func pageNumber(value string) (int, bool) {
	if value == "" {
		return 1, true
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > maxPage || strconv.Itoa(n) != value {
		return 0, false
	}
	return n, true
}
