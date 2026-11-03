package adminapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"github.com/TwiN/gatus/v5/plugins/incidents/sqlstore"
)

const secret = "correct-horse-battery-staple-0123456789"

func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

type fixture struct {
	mux    *http.ServeMux
	mu     sync.Mutex
	moment time.Time
	closer func() error
	logged []string
}

func (f *fixture) advance(by time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.moment = f.moment.Add(by)
}

func newFixture(t *testing.T, trustedProxies int) *fixture {
	t.Helper()
	db := databasetest.SQLite(t)
	store := sqlstore.New(db)
	if err := store.Migrate(); err != nil {
		t.Fatal(err)
	}
	f := &fixture{mux: http.NewServeMux(), moment: time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC), closer: db.Close}
	now := func() time.Time {
		f.mu.Lock()
		defer f.mu.Unlock()
		return f.moment
	}
	service := record.NewManager(store, now, func(string, any) {}, func(key string) bool { return key == "core_db" })
	logf := func(format string, args ...any) { f.logged = append(f.logged, fmt.Sprintf(format, args...)) }
	api, err := New(service, []Token{{Name: "alice", SHA256: hash(secret)}, {Name: "bob", SHA256: strings.ToUpper(hash("bobs-" + secret))}}, trustedProxies, now, logf)
	if err != nil {
		t.Fatal(err)
	}
	api.Register(func(pattern string, handler http.HandlerFunc) { f.mux.HandleFunc(pattern, handler) })
	return f
}

type call struct {
	method, path, body, token, from, forwarded string
}

func (f *fixture) do(c call) *httptest.ResponseRecorder {
	request := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
	if c.token != "" {
		request.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.from != "" {
		request.RemoteAddr = c.from
	}
	if c.forwarded != "" {
		request.Header.Set("X-Forwarded-For", c.forwarded)
	}
	recorder := httptest.NewRecorder()
	f.mux.ServeHTTP(recorder, request)
	return recorder
}

func (f *fixture) ok(t *testing.T, want int, c call) map[string]any {
	t.Helper()
	if c.token == "" {
		c.token = secret
	}
	response := f.do(c)
	if response.Code != want {
		t.Fatalf("%s %s: %d %s", c.method, c.path, response.Code, response.Body)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("not JSON: %s", response.Body)
	}
	return body
}

func wantError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status %d, want %d: %s", response.Code, status, response.Body)
	}
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body["error"] != code {
		t.Fatalf("error %q, want %q: %s", body["error"], code, response.Body)
	}
}

func TestIncidentFlowRecordsTheTokenNameAsActor(t *testing.T) {
	f := newFixture(t, 0)
	created := f.ok(t, 201, call{method: "POST", path: "/api/v1/admin/incidents", body: `{"title":"Down","severity":"major"}`})
	id := created["id"].(string)
	path := "/api/v1/admin/incidents/" + id
	f.ok(t, 201, call{method: "POST", path: path + "/notes", body: `{"note":"Paged the team."}`, token: "bobs-" + secret})
	f.ok(t, 200, call{method: "POST", path: path + "/state", body: `{"state":"mitigated"}`})
	f.ok(t, 200, call{method: "PATCH", path: path, body: `{"commander":"carol"}`})
	got := f.ok(t, 200, call{method: "GET", path: path})
	timeline := got["timeline"].([]any)
	if len(timeline) != 4 || got["state"] != "mitigated" || got["commander"] != "carol" {
		t.Fatalf("incident: %+v", got)
	}
	if actor := timeline[1].(map[string]any)["actor"]; actor != "bob" {
		t.Fatalf("actor: %v", actor)
	}
	list := f.ok(t, 200, call{method: "GET", path: "/api/v1/admin/incidents?state=mitigated&limit=5"})
	if len(list["incidents"].([]any)) != 1 {
		t.Fatalf("list: %+v", list)
	}
}

func TestReportFlow(t *testing.T) {
	f := newFixture(t, 0)
	created := f.ok(t, 201, call{method: "POST", path: "/api/v1/admin/reports", body: `{"title":"Slow","stage":"investigating","message":"Looking.","endpoints":[{"key":"core_db","impact":"partial"}]}`})
	path := "/api/v1/admin/reports/" + created["id"].(string)
	f.ok(t, 201, call{method: "POST", path: path + "/updates", body: `{"stage":"identified","message":"Found it."}`})
	f.ok(t, 200, call{method: "PATCH", path: path, body: `{"title":"Slow reads"}`})
	published := f.ok(t, 200, call{method: "PUT", path: path + "/publication", body: `{"published":true}`})
	if published["published_at"] == nil || published["stage"] != "identified" || published["title"] != "Slow reads" {
		t.Fatalf("report: %+v", published)
	}
	if got := f.ok(t, 200, call{method: "GET", path: path}); len(got["updates"].([]any)) != 2 {
		t.Fatalf("report: %+v", got)
	}
	if list := f.ok(t, 200, call{method: "GET", path: "/api/v1/admin/reports?published=true"}); len(list["reports"].([]any)) != 1 {
		t.Fatalf("list: %+v", list)
	}
	wantError(t, f.do(call{method: "GET", path: "/api/v1/admin/reports?published=maybe", token: secret}), 400, "invalid")
	wantError(t, f.do(call{method: "PUT", path: path + "/publication", body: `{}`, token: secret}), 400, "invalid")
}

func TestEveryRouteRefusesBadAndMissingTokens(t *testing.T) {
	f := newFixture(t, 0)
	id := record.NewID()
	routes := [][2]string{
		{"POST", "/api/v1/admin/incidents"}, {"GET", "/api/v1/admin/incidents"}, {"GET", "/api/v1/admin/incidents/" + id},
		{"PATCH", "/api/v1/admin/incidents/" + id}, {"POST", "/api/v1/admin/incidents/" + id + "/state"}, {"POST", "/api/v1/admin/incidents/" + id + "/notes"},
		{"POST", "/api/v1/admin/reports"}, {"GET", "/api/v1/admin/reports"}, {"GET", "/api/v1/admin/reports/" + id},
		{"PATCH", "/api/v1/admin/reports/" + id}, {"POST", "/api/v1/admin/reports/" + id + "/updates"}, {"PUT", "/api/v1/admin/reports/" + id + "/publication"},
	}
	for i, route := range routes {
		from := fmt.Sprintf("198.51.100.%d:1000", i+1)
		for _, token := range []string{"", "wrong", hash(secret)} {
			response := f.do(call{method: route[0], path: route[1], token: token, from: from, body: `{}`})
			wantError(t, response, 401, "unauthorized")
			if response.Header().Get("WWW-Authenticate") != "Bearer" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("%s %s: headers %v", route[0], route[1], response.Header())
			}
		}
	}
}

func TestOtherAuthorizationSchemesAreRefused(t *testing.T) {
	f := newFixture(t, 0)
	for _, value := range []string{secret, "Basic " + secret, "Bearer", "Bearer ", "bearer  " + secret} {
		request := httptest.NewRequest("GET", "/api/v1/admin/incidents", nil)
		request.Header.Set("Authorization", value)
		recorder := httptest.NewRecorder()
		f.mux.ServeHTTP(recorder, request)
		if recorder.Code != 401 {
			t.Fatalf("%q: %d", value, recorder.Code)
		}
	}
	request := httptest.NewRequest("GET", "/api/v1/admin/incidents", nil)
	request.Header.Set("Authorization", "bEaReR "+secret)
	recorder := httptest.NewRecorder()
	f.mux.ServeHTTP(recorder, request)
	if recorder.Code != 200 {
		t.Fatalf("the scheme is case-insensitive: %d", recorder.Code)
	}
}

func TestFailedAuthIsRateLimitedPerClient(t *testing.T) {
	f := newFixture(t, 0)
	attacker := "203.0.113.9:4000"
	for range maxFailures {
		wantError(t, f.do(call{method: "GET", path: "/api/v1/admin/incidents", token: "guess", from: attacker}), 401, "unauthorized")
	}
	blocked := f.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret, from: "203.0.113.9:4001"})
	wantError(t, blocked, 429, "rate_limited")
	if blocked.Header().Get("Retry-After") == "" {
		t.Fatal("no Retry-After")
	}
	if response := f.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret, from: "203.0.113.10:4000"}); response.Code != 200 {
		t.Fatalf("another client was blocked: %d", response.Code)
	}
	f.advance(failureWindow)
	if response := f.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret, from: attacker}); response.Code != 200 {
		t.Fatalf("the block never ended: %d", response.Code)
	}
}

func TestIPv6ClientsAreLimitedByNetwork(t *testing.T) {
	f := newFixture(t, 0)
	for i := range maxFailures {
		f.do(call{method: "GET", path: "/api/v1/admin/incidents", token: "guess", from: fmt.Sprintf("[2001:db8:1:2::%x]:4000", i+1)})
	}
	wantError(t, f.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret, from: "[2001:db8:1:2::ffff]:4000"}), 429, "rate_limited")
}

func TestForwardedAddressIsUsedOnlyBehindTrustedProxies(t *testing.T) {
	direct := newFixture(t, 0)
	for i := range maxFailures {
		direct.do(call{method: "GET", path: "/api/v1/admin/incidents", token: "guess", forwarded: fmt.Sprintf("10.0.0.%d", i)})
	}
	wantError(t, direct.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret, forwarded: "10.9.9.9"}), 429, "rate_limited")

	proxied := newFixture(t, 1)
	for i := range maxFailures {
		// A client cannot escape by writing its own entries to the left.
		proxied.do(call{method: "GET", path: "/api/v1/admin/incidents", token: "guess", forwarded: fmt.Sprintf("10.0.0.%d, 203.0.113.5", i)})
	}
	wantError(t, proxied.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret, forwarded: "203.0.113.5"}), 429, "rate_limited")
	if response := proxied.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret, forwarded: "203.0.113.6"}); response.Code != 200 {
		t.Fatalf("clients behind one proxy shared a limit: %d", response.Code)
	}
}

func TestLimiterStaysBounded(t *testing.T) {
	now := time.Date(2026, 11, 3, 10, 0, 0, 0, time.UTC)
	l := newLimiter(func() time.Time { return now })
	for i := range maxClients + 500 {
		l.fail(fmt.Sprintf("client-%d", i))
	}
	if len(l.clients) > maxClients+1 {
		t.Fatalf("table grew to %d", len(l.clients))
	}
	for range maxFailures {
		l.fail("yet-another")
	}
	if l.wait("one-more-unseen") == 0 {
		t.Fatal("a full table must not give new addresses a free pass")
	}
	now = now.Add(failureWindow)
	if l.wait("one-more-unseen") != 0 {
		t.Fatal("the overflow block must end")
	}
	l.fail("fresh")
	if len(l.clients) > 2 {
		t.Fatalf("expired entries were not swept: %d", len(l.clients))
	}
}

func TestBodiesAreLimitedAndStrict(t *testing.T) {
	f := newFixture(t, 0)
	huge := `{"title":"` + strings.Repeat("a", maxBodyBytes) + `","severity":"minor"}`
	wantError(t, f.do(call{method: "POST", path: "/api/v1/admin/incidents", body: huge, token: secret}), 413, "too_large")
	for _, body := range []string{``, `not json`, `[]`, `{"title":"x","severity":"minor"} {"again":1}`, `{"title":"x","severity":"minor","admin":true}`, `{"title":7}`} {
		wantError(t, f.do(call{method: "POST", path: "/api/v1/admin/incidents", body: body, token: secret}), 400, "invalid")
	}
	wantError(t, f.do(call{method: "POST", path: "/api/v1/admin/incidents", body: `{"title":"x","severity":"huge"}`, token: secret}), 400, "invalid")
	long := `{"title":"` + strings.Repeat("a", record.MaxTitleLength+1) + `","severity":"minor"}`
	wantError(t, f.do(call{method: "POST", path: "/api/v1/admin/incidents", body: long, token: secret}), 400, "invalid")
	wantError(t, f.do(call{method: "GET", path: "/api/v1/admin/incidents?limit=lots", token: secret}), 400, "invalid")
}

func TestRecordErrorsMapToStatuses(t *testing.T) {
	f := newFixture(t, 0)
	wantError(t, f.do(call{method: "GET", path: "/api/v1/admin/incidents/" + record.NewID(), token: secret}), 404, "not_found")
	wantError(t, f.do(call{method: "GET", path: "/api/v1/admin/reports/not-an-id", token: secret}), 404, "not_found")
	id := f.ok(t, 201, call{method: "POST", path: "/api/v1/admin/incidents", body: `{"title":"Down","severity":"major"}`})["id"].(string)
	state := "/api/v1/admin/incidents/" + id + "/state"
	wantError(t, f.do(call{method: "POST", path: state, body: `{"state":"closed"}`, token: secret}), 409, "invalid_transition")
	f.ok(t, 200, call{method: "POST", path: state, body: `{"state":"resolved"}`})
	f.ok(t, 200, call{method: "POST", path: state, body: `{"state":"closed"}`})
	wantError(t, f.do(call{method: "POST", path: state, body: `{"state":"open"}`, token: secret}), 409, "frozen")
	wantError(t, f.do(call{method: "POST", path: "/api/v1/admin/reports", body: `{"title":"x","stage":"identified","message":"y","endpoints":[{"key":"core_gone","impact":"major"}]}`, token: secret}), 400, "unknown_endpoint")
}

func TestHostileTextComesBackAsInertJSON(t *testing.T) {
	f := newFixture(t, 0)
	body := `{"title":"<script>alert(1)</script>","severity":"minor"}`
	response := f.do(call{method: "POST", path: "/api/v1/admin/incidents", body: body, token: secret})
	if response.Code != 201 || response.Header().Get("Content-Type") != "application/json" ||
		response.Header().Get("X-Content-Type-Options") != "nosniff" || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %v", response.Code, response.Header())
	}
	if strings.Contains(response.Body.String(), "<script>") {
		t.Fatalf("raw markup in a response: %s", response.Body)
	}
	var decoded map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil || decoded["title"] != "<script>alert(1)</script>" {
		t.Fatalf("the text must survive: %v %+v", err, decoded)
	}
}

func TestDatabaseFailureHidesItsDetail(t *testing.T) {
	f := newFixture(t, 0)
	if err := f.closer(); err != nil {
		t.Fatal(err)
	}
	response := f.do(call{method: "GET", path: "/api/v1/admin/incidents", token: secret})
	wantError(t, response, 503, "unavailable")
	if strings.Contains(response.Body.String(), "sql") || len(f.logged) != 1 {
		t.Fatalf("body %s, logged %v", response.Body, f.logged)
	}
}

func TestBadTokenConfigFailsByName(t *testing.T) {
	good := hash(secret)
	cases := []struct {
		name   string
		tokens []Token
		reason string
	}{
		{"no name", []Token{{SHA256: good}}, "name must be"},
		{"spaces in name", []Token{{Name: "a b", SHA256: good}}, "name must be"},
		{"short hash", []Token{{Name: "a", SHA256: "abc123"}}, "64 hex"},
		{"not hex", []Token{{Name: "a", SHA256: strings.Repeat("z", 64)}}, "64 hex"},
		{"plain token", []Token{{Name: "a", SHA256: secret}}, "64 hex"},
		{"same name", []Token{{Name: "a", SHA256: good}, {Name: "a", SHA256: hash("x")}}, "unique"},
		{"same hash", []Token{{Name: "a", SHA256: good}, {Name: "b", SHA256: strings.ToUpper(good)}}, "unique"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := New(nil, c.tokens, 0, time.Now, nil)
			if err == nil || !strings.Contains(err.Error(), c.reason) {
				t.Fatalf("error: %v", err)
			}
		})
	}
	if _, err := New(nil, nil, -1, time.Now, nil); err == nil {
		t.Fatal("a negative proxy count was accepted")
	}
}
