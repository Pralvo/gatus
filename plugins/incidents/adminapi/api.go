// Package adminapi is the token API for incidents and reports, under
// /api/v1/admin. It only ever returns JSON. Stored text is treated as hostile, so
// nothing here renders HTML, and browsers are told not to guess a content type.
package adminapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

const (
	// maxBodyBytes allows a full postmortem, which JSON can escape to several
	// times its length.
	maxBodyBytes = 1 << 20
	// requestTimeout stops a slow database from holding a request open.
	requestTimeout = 10 * time.Second
)

// API serves the routes. Create it with New.
type API struct {
	service record.Service
	gate    *Gate
	logf    func(format string, args ...any)
}

// New validates the tokens and returns an API. now is the clock for rate limits,
// and logf receives failures that are not shown to clients.
func New(service record.Service, tokens []Token, trustedProxies int, now func() time.Time, logf func(format string, args ...any)) (*API, error) {
	gate, err := NewGate(tokens, trustedProxies, now)
	if err != nil {
		return nil, err
	}
	return &API{service: service, gate: gate, logf: logf}, nil
}

// handler does one operation for an authenticated actor, and returns the status
// and JSON body of a success.
type handler func(r *http.Request, actor string) (int, any, error)

// Register adds every route through add, which is Context.HandleFunc in the plugin.
func (a *API) Register(add func(pattern string, handler http.HandlerFunc)) {
	routes := map[string]handler{
		"POST /api/v1/admin/incidents":               a.createIncident,
		"GET /api/v1/admin/incidents":                a.listIncidents,
		"GET /api/v1/admin/incidents/{id}":           a.getIncident,
		"PATCH /api/v1/admin/incidents/{id}":         a.changeIncident,
		"POST /api/v1/admin/incidents/{id}/state":    a.setIncidentState,
		"POST /api/v1/admin/incidents/{id}/notes":    a.addIncidentNote,
		"POST /api/v1/admin/reports":                 a.createReport,
		"GET /api/v1/admin/reports":                  a.listReports,
		"GET /api/v1/admin/reports/{id}":             a.getReport,
		"PATCH /api/v1/admin/reports/{id}":           a.changeReport,
		"POST /api/v1/admin/reports/{id}/updates":    a.addReportUpdate,
		"PUT /api/v1/admin/reports/{id}/publication": a.setReportPublished,
	}
	for pattern, h := range routes {
		add(pattern, a.guard(h))
	}
}

// guard is the one way into a handler: rate limit, then token, then body limit.
func (a *API) guard(h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := a.gate.Admit(w, r)
		if !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
		defer cancel()
		r = r.WithContext(ctx)
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		status, body, err := h(r, actor)
		if err != nil {
			a.writeFailure(w, r, err)
			return
		}
		writeJSON(w, status, body)
	}
}

var errTooLarge = errors.New("request body is too large")

func (a *API) writeFailure(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", err.Error())
	case errors.Is(err, record.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "no such record")
	case errors.Is(err, record.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid", err.Error())
	case errors.Is(err, record.ErrUnknownEndpoint):
		writeError(w, http.StatusBadRequest, "unknown_endpoint", err.Error())
	case errors.Is(err, record.ErrInvalidTransition):
		writeError(w, http.StatusConflict, "invalid_transition", err.Error())
	case errors.Is(err, record.ErrFrozen):
		writeError(w, http.StatusConflict, "frozen", err.Error())
	default:
		// Database errors stay in the log. Clients learn only to try again.
		a.logf("%s %s: %s", r.Method, r.Pattern, err.Error())
		writeError(w, http.StatusServiceUnavailable, "unavailable", "storage is unavailable")
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body) // the default encoder also escapes <, > and &
}

// decode reads exactly one JSON value with no unknown fields.
func decode(r *http.Request, into any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(into)
	if err == nil && decoder.Decode(&struct{}{}) != io.EOF {
		err = errors.New("trailing data")
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return errTooLarge
	}
	if err != nil {
		return fmt.Errorf("%w: the body must be one JSON object with known fields", record.ErrInvalid)
	}
	return nil
}

// window reads the limit and offset query parameters.
func window(r *http.Request) (limit, offset int, err error) {
	query := r.URL.Query()
	if limit, err = number(query.Get("limit")); err != nil {
		return 0, 0, err
	}
	if offset, err = number(query.Get("offset")); err != nil {
		return 0, 0, err
	}
	return limit, offset, nil
}

func number(value string) (int, error) {
	if value == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%w: limit and offset must be numbers", record.ErrInvalid)
	}
	return n, nil
}
