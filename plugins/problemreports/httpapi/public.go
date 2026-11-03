// Package httpapi serves problem reports: a public route that takes one report,
// a public route that tells the page whether the form is on, and token routes
// for reading and deleting reports. Every answer is JSON.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/TwiN/gatus/v5/plugins/incidents/adminapi"
	"github.com/TwiN/gatus/v5/plugins/problemreports/store"
	"github.com/TwiN/gatus/v5/plugins/problemreports/visitor"
)

const (
	// maxBodyBytes holds the longest description and details, escaped.
	maxBodyBytes = 8 << 10
	// requestTimeout stops a slow database from holding a request open.
	requestTimeout = 10 * time.Second
	minDescription = 10
	maxText        = 2000
	maxPage        = 512
	maxService     = 200
)

// Settings is what the page shows before anyone sends a report.
type Settings struct {
	PrivacyURL    string `json:"privacyUrl"`
	Contact       string `json:"contact"`
	RetentionDays int    `json:"retentionDays"`
}

// Adder saves a report.
type Adder interface {
	Add(ctx context.Context, r store.Report) error
}

// Public takes reports from visitors.
type Public struct {
	Store         Adder
	Settings      Settings
	Known         func(service string) bool
	Limiter       *visitor.Limiter
	CountryHeader string
	Proxies       visitor.Proxies
	Now           func() time.Time
	Logf          func(format string, args ...any)
}

// Register adds the public routes through add, which is Context.HandleFunc.
func (p *Public) Register(add func(pattern string, handler http.HandlerFunc)) {
	add("GET /api/v1/problem-reports/settings", p.settings)
	add("POST /api/v1/problem-reports", p.create)
}

func (p *Public) settings(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true, "privacyUrl": p.Settings.PrivacyURL,
		"contact": p.Settings.Contact, "retentionDays": p.Settings.RetentionDays})
}

// submission is the body a visitor sends. Website is a honeypot: the form hides
// it from people, so only a program fills it in.
type submission struct {
	Description string `json:"description"`
	Service     string `json:"service"`
	Details     string `json:"details"`
	Page        string `json:"page"`
	Website     string `json:"website"`
}

func (p *Public) create(w http.ResponseWriter, r *http.Request) {
	header := w.Header()
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Cache-Control", "no-store")
	if !sameOrigin(r) {
		writeError(w, http.StatusForbidden, "cross_origin", "reports are accepted only from this site's own pages")
		return
	}
	if kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || kind != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "the body must be application/json")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	var body submission
	if err := decode(r.Body, &body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "the report is too long")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid", "the body must be one JSON object with known fields")
		return
	}
	report, problem := p.validate(body)
	if problem != "" {
		writeError(w, http.StatusBadRequest, "invalid", problem)
		return
	}
	// The address is used here, in memory, and nowhere else.
	if ok, wait := p.Limiter.Allow(adminapi.ClientAddress(r, p.Proxies.Count)); !ok {
		header.Set("Retry-After", strconv.Itoa(int(wait.Round(time.Second).Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many reports; try again later")
		return
	}
	reference, err := newReference()
	if err != nil {
		p.Logf("make a reference: %s", err.Error())
		writeError(w, http.StatusServiceUnavailable, "unavailable", "reports cannot be saved right now")
		return
	}
	if body.Website != "" {
		// A program filled in the hidden field. It gets the same answer as a
		// person, so it learns nothing, and the report is dropped.
		writeJSON(w, http.StatusCreated, map[string]string{"reference": reference})
		return
	}
	agent := visitor.ParseAgent(r.UserAgent())
	report.ID = reference
	report.ReceivedAt = p.Now().UTC().Truncate(time.Second)
	report.Country = visitor.Country(r, p.CountryHeader, p.Proxies)
	report.Browser, report.BrowserMajor, report.OS = agent.Browser, agent.Major, agent.OS
	ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
	defer cancel()
	if err := p.Store.Add(ctx, report); err != nil {
		p.Logf("save a report: %s", err.Error())
		writeError(w, http.StatusServiceUnavailable, "unavailable", "reports cannot be saved right now")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"reference": reference})
}

// sameOrigin refuses a request a browser marks as coming from another site. No
// CORS headers are ever sent, so another site cannot read an answer either.
func sameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // not sent by a browser's fetch; the rate limit still applies
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.Host != "" && strings.EqualFold(parsed.Host, r.Host)
}

// validate returns the report to save, or a reason it was refused.
func (p *Public) validate(b submission) (store.Report, string) {
	description := strings.TrimSpace(b.Description)
	details := strings.TrimSpace(b.Details)
	switch n := utf8.RuneCountInString(description); {
	case n < minDescription:
		return store.Report{}, "description must be at least 10 characters"
	case n > maxText:
		return store.Report{}, "description must be at most 2000 characters"
	}
	if utf8.RuneCountInString(details) > maxText {
		return store.Report{}, "details must be at most 2000 characters"
	}
	if !plainText(description) || !plainText(details) {
		return store.Report{}, "description and details must be plain text"
	}
	if b.Service != "" && (len(b.Service) > maxService || !p.Known(b.Service)) {
		return store.Report{}, "service must be one shown on this status page"
	}
	page, ok := sitePath(b.Page)
	if !ok {
		return store.Report{}, "page must be a path on this site, such as /endpoints/core_api"
	}
	return store.Report{Description: description, Details: details, Service: b.Service, Page: page}, ""
}

// plainText allows line breaks and tabs but no other control characters, which
// Postgres refuses in part and which only ever hide text.
func plainText(s string) bool {
	for _, c := range s {
		if (c < 0x20 && c != '\n' && c != '\r' && c != '\t') || c == 0x7f {
			return false
		}
	}
	return true
}

// sitePath accepts "" or a path on this site, and keeps only the path: a query
// or fragment can carry anything, so it is dropped.
func sitePath(page string) (string, bool) {
	if page == "" {
		return "", true
	}
	if len(page) > maxPage || !strings.HasPrefix(page, "/") || strings.HasPrefix(page, "//") || strings.ContainsAny(page, "\\") {
		return "", false
	}
	for i := 0; i < len(page); i++ {
		if page[i] <= 0x20 || page[i] >= 0x7f {
			return "", false
		}
	}
	parsed, err := url.Parse(page)
	if err != nil || parsed.Scheme != "" || parsed.Host != "" || parsed.Opaque != "" {
		return "", false
	}
	return parsed.EscapedPath(), true
}

// newReference returns "PR-" and 16 base32 characters: 80 random bits, which
// is enough that a reference cannot be guessed and short enough to read out.
func newReference() (string, error) {
	raw := make([]byte, 10)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "PR-" + base32.StdEncoding.EncodeToString(raw), nil
}

// decode reads exactly one JSON value with no unknown fields.
func decode(body io.Reader, into any) error {
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return err
		}
		return errors.New("trailing data")
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body) // the default encoder also escapes <, > and &
}
