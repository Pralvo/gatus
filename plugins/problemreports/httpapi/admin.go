package httpapi

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/TwiN/gatus/v5/plugins/incidents/adminapi"
	"github.com/TwiN/gatus/v5/plugins/problemreports/store"
)

const (
	defaultLimit  = 50
	maxLimit      = 200
	summaryWindow = time.Hour
)

// Reader is what the token routes need from the store.
type Reader interface {
	List(ctx context.Context, f store.Filter) ([]store.Report, bool, error)
	Get(ctx context.Context, id string) (store.Report, error)
	Delete(ctx context.Context, id string) error
	Summary(ctx context.Context, since time.Time) (byCountry, byService []store.Count, err error)
}

// Admin serves the token routes under /api/v1/admin/problem-reports.
type Admin struct {
	Store Reader
	Gate  *adminapi.Gate
	Now   func() time.Time
	Logf  func(format string, args ...any)
}

// Register adds the token routes through add, which is Context.HandleFunc.
func (a *Admin) Register(add func(pattern string, handler http.HandlerFunc)) {
	add("GET /api/v1/admin/problem-reports", a.guard(a.list))
	add("GET /api/v1/admin/problem-reports/summary", a.guard(a.summary))
	add("GET /api/v1/admin/problem-reports/{id}", a.guard(a.get))
	add("DELETE /api/v1/admin/problem-reports/{id}", a.guard(a.delete))
}

// view is a report as the token routes show it.
type view struct {
	Reference    string    `json:"reference"`
	ReceivedAt   time.Time `json:"receivedAt"`
	Service      string    `json:"service"`
	Page         string    `json:"page"`
	Description  string    `json:"description"`
	Details      string    `json:"details"`
	Country      string    `json:"country"`
	Browser      string    `json:"browser"`
	BrowserMajor int       `json:"browserMajor"`
	OS           string    `json:"os"`
}

func viewOf(r store.Report) view {
	return view{r.ID, r.ReceivedAt, r.Service, r.Page, r.Description, r.Details, r.Country, r.Browser, r.BrowserMajor, r.OS}
}

var errInvalid = errors.New("invalid")

type invalid string

func (i invalid) Error() string { return string(i) }
func (i invalid) Unwrap() error { return errInvalid }

// guard checks the token, then runs h with a deadline and writes its answer.
func (a *Admin) guard(h func(r *http.Request) (int, any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := a.Gate.Admit(w, r); !ok {
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), requestTimeout)
		defer cancel()
		status, body, err := h(r.WithContext(ctx))
		switch {
		case err == nil && body == nil:
			w.WriteHeader(status)
		case err == nil:
			writeJSON(w, status, body)
		case errors.Is(err, errInvalid):
			writeError(w, http.StatusBadRequest, "invalid", err.Error())
		case errors.Is(err, store.ErrNotFound):
			writeError(w, http.StatusNotFound, "not_found", "no such record")
		default:
			a.Logf("%s %s: %s", r.Method, r.Pattern, err.Error())
			writeError(w, http.StatusServiceUnavailable, "unavailable", "storage is unavailable")
		}
	}
}

var (
	reference   = regexp.MustCompile(`^PR-[A-Z2-7]{16}$`)
	countryCode = regexp.MustCompile(`^[A-Z]{2}$`)
)

// id reads the reference from the path. A malformed one cannot exist, so it is
// a 404 like any other unknown reference.
func id(r *http.Request) (string, error) {
	value := r.PathValue("id")
	if !reference.MatchString(value) {
		return "", store.ErrNotFound
	}
	return value, nil
}

func (a *Admin) list(r *http.Request) (int, any, error) {
	filter, err := filterOf(r)
	if err != nil {
		return 0, nil, err
	}
	reports, more, err := a.Store.List(r.Context(), filter)
	if err != nil {
		return 0, nil, err
	}
	views := make([]view, len(reports))
	for i, report := range reports {
		views[i] = viewOf(report)
	}
	return http.StatusOK, map[string]any{"reports": views, "more": more}, nil
}

func filterOf(r *http.Request) (store.Filter, error) {
	query := r.URL.Query()
	f := store.Filter{Service: query.Get("service"), Country: query.Get("country"), Limit: defaultLimit}
	if f.Country != "" && !countryCode.MatchString(f.Country) {
		return f, invalid("country must be two capital letters")
	}
	var err error
	if f.From, err = timeOf(query.Get("from")); err != nil {
		return f, err
	}
	if f.To, err = timeOf(query.Get("to")); err != nil {
		return f, err
	}
	if value := query.Get("limit"); value != "" {
		if f.Limit, err = strconv.Atoi(value); err != nil || f.Limit < 1 || f.Limit > maxLimit {
			return f, invalid("limit must be a number from 1 to 200")
		}
	}
	if value := query.Get("offset"); value != "" {
		if f.Offset, err = strconv.Atoi(value); err != nil || f.Offset < 0 {
			return f, invalid("offset must be a number from 0")
		}
	}
	return f, nil
}

func timeOf(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, invalid("from and to must be RFC 3339 times, such as 2026-11-04T10:00:00Z")
	}
	return t, nil
}

func (a *Admin) get(r *http.Request) (int, any, error) {
	id, err := id(r)
	if err != nil {
		return 0, nil, err
	}
	report, err := a.Store.Get(r.Context(), id)
	if err != nil {
		return 0, nil, err
	}
	return http.StatusOK, viewOf(report), nil
}

func (a *Admin) delete(r *http.Request) (int, any, error) {
	id, err := id(r)
	if err != nil {
		return 0, nil, err
	}
	if err := a.Store.Delete(r.Context(), id); err != nil {
		return 0, nil, err
	}
	return http.StatusNoContent, nil, nil
}

// summary counts the last hour's reports, so a burst from one region or about
// one service stands out.
func (a *Admin) summary(r *http.Request) (int, any, error) {
	until := a.Now().UTC().Truncate(time.Second)
	since := until.Add(-summaryWindow)
	countries, services, err := a.Store.Summary(r.Context(), since)
	if err != nil {
		return 0, nil, err
	}
	total := 0
	for _, c := range countries {
		total += c.Count
	}
	return http.StatusOK, map[string]any{"since": since, "until": until, "total": total,
		"countries": countries, "services": services}, nil
}
