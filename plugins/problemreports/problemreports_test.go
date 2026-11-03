package problemreports

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/plugintest"
	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/problemreports/store"
)

const (
	secret   = "problem-reports-plugin-token-0123456789"
	address  = "203.0.113.77"
	agent    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
	required = "privacy-url: https://example.com/privacy\ncontact: privacy@example.com\n"
)

func tokens() string {
	sum := sha256.Sum256([]byte(secret))
	return "tokens:\n  - name: alice\n    sha256: " + hex.EncodeToString(sum[:]) + "\n"
}

// provider offers a ready database, because the harness gives further
// definitions no config.
func provider(db *database.DB) plugin.Definition {
	return plugin.Definition{
		Name:     "database",
		Provides: []plugin.Key{database.Key},
		Start:    func(ctx *plugin.Context) error { ctx.Provide(database.Key, db); return nil },
	}
}

func core() map[plugin.Key]any {
	return map[plugin.Key]any{plugin.CoreConfig: &config.Config{Endpoints: []*endpoint.Endpoint{{Group: "core", Name: "api"}}}}
}

func TestRefusesToStartWithoutANoticeOrContact(t *testing.T) {
	cases := map[string]string{
		"no privacy-url":                "contact: privacy@example.com\n",
		"no contact":                    "privacy-url: https://example.com/privacy\n",
		"an http notice":                "privacy-url: http://example.com/privacy\ncontact: privacy@example.com\n",
		"a contact that is not one":     "privacy-url: /privacy\ncontact: write to us\n",
		"retention over a year":         required + "retention: 8761h\n",
		"a country without a proxy":     required + "country-header: X-Client-Region\n",
		"a header name that is not one": required + "trusted-proxies: 1\ncountry-header: \"X Region\"\n",
		"a bad proxy network":           required + "trusted-proxies: 1\nproxy-networks: [10.0.0.0]\n",
		"an unknown setting":            required + "keep-ip: true\n",
	}
	for name, cfg := range cases {
		t.Run(name, func(t *testing.T) {
			h := plugintest.Load(t, Definition, cfg, core(), provider(databasetest.SQLite(t)))
			for _, status := range h.Host.Statuses() {
				if status.Name == Definition.Name && status.State != plugin.StateFailed {
					t.Fatalf("state %s, want failed", status.State)
				}
			}
			if h.Get("/api/v1/problem-reports/settings").Code != http.StatusNotFound {
				t.Fatal("the form's settings are served by a plugin that did not start")
			}
		})
	}
}

func post(h *plugintest.Harness, body string, headers ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/problem-reports", strings.NewReader(body))
	r.RemoteAddr = "10.0.0.2:4000"
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("User-Agent", agent)
	r.Header.Set("X-Forwarded-For", address)
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Set(headers[i], headers[i+1])
	}
	return h.Do(r)
}

// A report goes in through the real host, and the stored row holds no address
// and no User-Agent, in any column, on either database.
func TestStoresNoAddressOrUserAgent(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		cfg := required + "trusted-proxies: 1\ncountry-header: X-Client-Region\n" + tokens()
		h := plugintest.Start(t, Definition, cfg, core(), provider(db))
		w := post(h, `{"description":"The API answers 502 from here","service":"core_api","page":"/endpoints/core_api"}`, "X-Client-Region", "IN")
		if w.Code != http.StatusCreated {
			t.Fatalf("status %d: %s", w.Code, w.Body)
		}
		var answer struct{ Reference string }
		_ = json.Unmarshal(w.Body.Bytes(), &answer)

		rows, err := db.SQL().Query("SELECT * FROM problem_reports")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = rows.Close() }()
		columns, _ := rows.Columns()
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		count := 0
		for rows.Next() {
			count++
			if err := rows.Scan(pointers...); err != nil {
				t.Fatal(err)
			}
			for i, value := range values {
				text := fmt.Sprintf("%s", value)
				if strings.Contains(text, "203.0.113") || strings.Contains(text, "Mozilla") || strings.Contains(text, "AppleWebKit") {
					t.Errorf("column %s holds %q", columns[i], text)
				}
			}
		}
		if count != 1 {
			t.Fatalf("stored %d rows, want 1", count)
		}
		got, err := store.New(db).Get(context.Background(), answer.Reference)
		if err != nil || got.Country != "IN" || got.Browser != "Chrome" || got.BrowserMajor != 141 || got.OS != "Windows" {
			t.Fatalf("stored %+v, %v", got, err)
		}
	})
}

func TestServesSettingsAndAdminRoutes(t *testing.T) {
	h := plugintest.Start(t, Definition, required+"retention: 720h\n"+tokens(), core(), provider(databasetest.SQLite(t)))
	w := h.Get("/api/v1/problem-reports/settings")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"retentionDays":30`) {
		t.Fatalf("settings: %d %s", w.Code, w.Body)
	}
	if code := h.Get("/api/v1/admin/problem-reports").Code; code != http.StatusUnauthorized {
		t.Fatalf("the admin list without a token: %d", code)
	}
	r := httptest.NewRequest(http.MethodGet, "/api/v1/admin/problem-reports/summary", nil)
	r.Header.Set("Authorization", "Bearer "+secret)
	if code := h.Do(r).Code; code != http.StatusOK {
		t.Fatalf("the summary with a token: %d", code)
	}
}

// Start purges reports older than the retention period; the hourly job does
// the same with the same function.
func TestPurgesOldReportsOnStart(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		fixed := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
		now = func() time.Time { return fixed }
		t.Cleanup(func() { now = time.Now })
		s := store.New(db)
		if err := s.Migrate(); err != nil {
			t.Fatal(err)
		}
		ctx := context.Background()
		for id, age := range map[string]time.Duration{"PR-OLD": 90*day + time.Second, "PR-NEW": 90*day - time.Second} {
			if err := s.Add(ctx, store.Report{ID: id, ReceivedAt: fixed.Add(-age), Description: "a report"}); err != nil {
				t.Fatal(err)
			}
		}
		plugintest.Start(t, Definition, required, core(), provider(db))
		if _, err := s.Get(ctx, "PR-OLD"); err != store.ErrNotFound {
			t.Fatalf("a report past 90 days is still there: %v", err)
		}
		if _, err := s.Get(ctx, "PR-NEW"); err != nil {
			t.Fatalf("a report inside 90 days went: %v", err)
		}
	})
}
