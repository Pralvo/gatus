package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents/adminapi"
	"github.com/TwiN/gatus/v5/plugins/problemreports/store"
)

const secret = "problem-reports-test-token-0123456789"

const (
	refA = "PR-AAAAAAAAAAAAAAAA"
	refB = "PR-BBBBBBBBBBBBBBBB"
)

func newAdmin(t *testing.T, db *database.DB) *http.ServeMux {
	t.Helper()
	s := store.New(db)
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	for _, r := range []store.Report{
		{ID: refA, ReceivedAt: clock.Add(-2 * time.Hour), Service: "core_api", Description: "Old report here", Country: "IN"},
		{ID: refB, ReceivedAt: clock.Add(-10 * time.Minute), Service: "core_api", Description: "New report here", Country: "DE"},
	} {
		if err := s.Add(context.Background(), r); err != nil {
			t.Fatal(err)
		}
	}
	sum := sha256.Sum256([]byte(secret))
	gate, err := adminapi.NewGate([]adminapi.Token{{Name: "alice", SHA256: hex.EncodeToString(sum[:])}}, 0, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	(&Admin{Store: s, Gate: gate, Now: func() time.Time { return clock }, Logf: t.Logf}).Register(func(p string, h http.HandlerFunc) { mux.Handle(p, h) })
	return mux
}

func call(mux *http.ServeMux, method, path, token string) (int, map[string]any) {
	r := httptest.NewRequest(method, path, nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w.Code, body
}

func TestAdminNeedsAToken(t *testing.T) {
	mux := newAdmin(t, databasetest.SQLite(t))
	for _, route := range [][2]string{
		{"GET", "/api/v1/admin/problem-reports"},
		{"GET", "/api/v1/admin/problem-reports/summary"},
		{"GET", "/api/v1/admin/problem-reports/" + refA},
		{"DELETE", "/api/v1/admin/problem-reports/" + refA},
	} {
		for _, token := range []string{"", "wrong-token"} {
			if status, body := call(mux, route[0], route[1], token); status != http.StatusUnauthorized || body["error"] != "unauthorized" {
				t.Errorf("%s %s with token %q: %d %v", route[0], route[1], token, status, body)
			}
		}
	}
	if status, _ := call(mux, "GET", "/api/v1/admin/problem-reports/"+refA, secret); status != http.StatusOK {
		t.Fatal("the report went missing while unauthorised requests were refused")
	}
}

func TestAdminReadsAndDeletes(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		mux := newAdmin(t, db)
		status, body := call(mux, "GET", "/api/v1/admin/problem-reports?service=core_api&limit=1", secret)
		reports, _ := body["reports"].([]any)
		if status != http.StatusOK || len(reports) != 1 || body["more"] != true {
			t.Fatalf("list: %d %v", status, body)
		}
		if first, _ := reports[0].(map[string]any); first["reference"] != refB {
			t.Fatalf("newest first: %v", first)
		}
		_, body = call(mux, "GET", "/api/v1/admin/problem-reports?country=IN", secret)
		if reports, _ := body["reports"].([]any); len(reports) != 1 {
			t.Fatalf("by country: %v", body)
		}
		_, body = call(mux, "GET", "/api/v1/admin/problem-reports?from=2026-11-04T10:00:00Z", secret)
		if reports, _ := body["reports"].([]any); len(reports) != 1 {
			t.Fatalf("by time: %v", body)
		}
		for _, bad := range []string{"?country=in", "?from=yesterday", "?limit=0", "?limit=201", "?offset=-1"} {
			if status, body := call(mux, "GET", "/api/v1/admin/problem-reports"+bad, secret); status != http.StatusBadRequest {
				t.Errorf("%s: %d %v", bad, status, body)
			}
		}

		status, body = call(mux, "GET", "/api/v1/admin/problem-reports/summary", secret)
		if status != http.StatusOK || body["total"] != 1.0 {
			t.Fatalf("summary of the last hour: %d %v", status, body)
		}

		if status, body := call(mux, "GET", "/api/v1/admin/problem-reports/"+refA, secret); status != http.StatusOK || body["description"] != "Old report here" {
			t.Fatalf("get: %d %v", status, body)
		}
		if status, _ := call(mux, "DELETE", "/api/v1/admin/problem-reports/"+refA, secret); status != http.StatusNoContent {
			t.Fatalf("delete: %d", status)
		}
		for _, method := range []string{"GET", "DELETE"} {
			if status, body := call(mux, method, "/api/v1/admin/problem-reports/"+refA, secret); status != http.StatusNotFound || body["error"] != "not_found" {
				t.Fatalf("%s after delete: %d %v", method, status, body)
			}
		}
		if status, _ := call(mux, "GET", "/api/v1/admin/problem-reports/not-a-reference", secret); status != http.StatusNotFound {
			t.Fatalf("a malformed reference: %d", status)
		}
	})
}
