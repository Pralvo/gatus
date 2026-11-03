package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugins/problemreports/store"
	"github.com/TwiN/gatus/v5/plugins/problemreports/visitor"
)

type memory struct {
	saved []store.Report
	fail  bool
}

func (m *memory) Add(_ context.Context, r store.Report) error {
	if m.fail {
		return errors.New("database is down")
	}
	m.saved = append(m.saved, r)
	return nil
}

var clock = time.Date(2026, 11, 4, 10, 30, 15, 999, time.UTC)

const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0"

func newPublic(t *testing.T, perClient int) (*Public, *memory) {
	t.Helper()
	limiter, err := visitor.NewLimiter(perClient, 100, time.Hour, func() time.Time { return clock })
	if err != nil {
		t.Fatal(err)
	}
	m := &memory{}
	return &Public{
		Store:         m,
		Known:         func(key string) bool { return key == "core_api" || key == "core" },
		Limiter:       limiter,
		CountryHeader: "X-Client-Region",
		Proxies:       visitor.Proxies{Count: 1},
		Now:           func() time.Time { return clock },
		Logf:          t.Logf,
	}, m
}

func send(p *Public, body string, headers ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/problem-reports", strings.NewReader(body))
	r.Host = "status.example.com"
	r.RemoteAddr = "10.0.0.2:4000"
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://status.example.com")
	r.Header.Set("X-Forwarded-For", "203.0.113.9")
	r.Header.Set("User-Agent", firefox)
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	w := httptest.NewRecorder()
	p.create(w, r)
	return w
}

const valid = `{"description":"The dashboard shows a blank page","service":"core_api","page":"/endpoints/core_api?x=1#y"}`

func TestCreateSavesOnlyWhatItShould(t *testing.T) {
	p, m := newPublic(t, 5)
	w := send(p, valid, "X-Client-Region", "IN")
	if w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var answer struct{ Reference string }
	_ = json.Unmarshal(w.Body.Bytes(), &answer)
	if !regexp.MustCompile(`^PR-[A-Z2-7]{16}$`).MatchString(answer.Reference) {
		t.Fatalf("reference %q", answer.Reference)
	}
	if len(m.saved) != 1 {
		t.Fatalf("saved %d reports", len(m.saved))
	}
	want := store.Report{ID: answer.Reference, ReceivedAt: time.Date(2026, 11, 4, 10, 30, 15, 0, time.UTC),
		Service: "core_api", Page: "/endpoints/core_api", Description: "The dashboard shows a blank page",
		Country: "IN", Browser: "Firefox", BrowserMajor: 143, OS: "Linux"}
	if m.saved[0] != want {
		t.Fatalf("saved %+v\nwant  %+v", m.saved[0], want)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("the answer allows another origin")
	}
}

func TestCreateRefuses(t *testing.T) {
	long := strings.Repeat("a", 2001)
	cases := []struct {
		name    string
		body    string
		headers []string
		status  int
	}{
		{"short description", `{"description":"too short"}`, nil, 400},
		{"description of spaces", `{"description":"          x"}`, nil, 400},
		{"long description", `{"description":"` + long + `"}`, nil, 400},
		{"long details", `{"description":"long enough text","details":"` + long[:2001] + `"}`, nil, 400},
		{"control character", `{"description":"long enough\u0000text"}`, nil, 400},
		{"unknown service", `{"description":"long enough text","service":"other"}`, nil, 400},
		{"another site's page", `{"description":"long enough text","page":"https://evil.example/"}`, nil, 400},
		{"protocol-relative page", `{"description":"long enough text","page":"//evil.example/"}`, nil, 400},
		{"backslash page", `{"description":"long enough text","page":"/\\evil.example"}`, nil, 400},
		{"unknown field", `{"description":"long enough text","ip":"1.2.3.4"}`, nil, 400},
		{"two objects", `{"description":"long enough text"}{}`, nil, 400},
		{"not JSON", `description=long+enough+text`, []string{"Content-Type", "application/x-www-form-urlencoded"}, 415},
		{"over 8 KB", `{"description":"long enough text","details":"` + strings.Repeat("\\u00e9", 1500) + `"}`, nil, 413},
		{"another origin", valid, []string{"Origin", "https://evil.example"}, 403},
		{"a cross-site fetch", valid, []string{"Sec-Fetch-Site", "cross-site"}, 403},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, m := newPublic(t, 5)
			w := send(p, c.body, c.headers...)
			if w.Code != c.status {
				t.Fatalf("status %d, want %d: %s", w.Code, c.status, w.Body)
			}
			if len(m.saved) != 0 {
				t.Fatal("a refused report was saved")
			}
		})
	}
}

func TestCreateAcceptsTheLimits(t *testing.T) {
	p, m := newPublic(t, 5)
	body := `{"description":"` + strings.Repeat("é", 2000) + `","details":"` + strings.Repeat("d", 2000) + `","service":"core"}`
	if w := send(p, body); w.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if len(m.saved) != 1 || m.saved[0].Page != "" {
		t.Fatalf("saved %+v", m.saved)
	}
}

func TestHoneypotAnswersLikeASuccessAndSavesNothing(t *testing.T) {
	p, m := newPublic(t, 5)
	w := send(p, `{"description":"long enough text","website":"http://spam.example"}`)
	if w.Code != http.StatusCreated || !strings.Contains(w.Body.String(), `"reference":"PR-`) {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	if len(m.saved) != 0 {
		t.Fatal("the honeypot report was saved")
	}
}

func TestRateLimitPerClient(t *testing.T) {
	p, m := newPublic(t, 2)
	for range 2 {
		if w := send(p, valid); w.Code != http.StatusCreated {
			t.Fatalf("status %d", w.Code)
		}
	}
	w := send(p, valid)
	if w.Code != http.StatusTooManyRequests || w.Header().Get("Retry-After") != "3601" {
		t.Fatalf("third report: status %d, Retry-After %q", w.Code, w.Header().Get("Retry-After"))
	}
	if w := send(p, valid, "X-Forwarded-For", "198.51.100.7"); w.Code != http.StatusCreated {
		t.Fatalf("another client: status %d", w.Code)
	}
	if len(m.saved) != 3 {
		t.Fatalf("saved %d reports, want 3", len(m.saved))
	}
}

func TestCountryOnlyThroughTheProxy(t *testing.T) {
	p, m := newPublic(t, 5)
	send(p, valid, "X-Client-Region", "DE", "X-Forwarded-For", "")
	if len(m.saved) != 1 || m.saved[0].Country != "" {
		t.Fatalf("a request that did not come through the proxy kept country %q", m.saved[0].Country)
	}
}

func TestCreateWhenTheDatabaseFails(t *testing.T) {
	p, m := newPublic(t, 5)
	m.fail = true
	if w := send(p, valid); w.Code != http.StatusServiceUnavailable || strings.Contains(w.Body.String(), "down") {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
}

func TestSettings(t *testing.T) {
	p, _ := newPublic(t, 5)
	p.Settings = Settings{PrivacyURL: "/privacy", Contact: "privacy@example.com", RetentionDays: 90}
	w := httptest.NewRecorder()
	p.settings(w, httptest.NewRequest(http.MethodGet, "/api/v1/problem-reports/settings", nil))
	want := `{"contact":"privacy@example.com","enabled":true,"privacyUrl":"/privacy","retentionDays":90}`
	if strings.TrimSpace(w.Body.String()) != want {
		t.Fatalf("settings = %s", w.Body)
	}
}
