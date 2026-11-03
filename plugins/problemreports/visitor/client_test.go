package visitor

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func request(remote string, headers ...string) *http.Request {
	r := httptest.NewRequest("POST", "/api/v1/problem-reports", nil)
	r.RemoteAddr = remote
	for i := 0; i+1 < len(headers); i += 2 {
		r.Header.Add(headers[i], headers[i+1])
	}
	return r
}

func TestCountry(t *testing.T) {
	behind := Proxies{Count: 1}
	inNetwork := Proxies{Count: 1, Networks: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}}
	const fwd, region = "X-Forwarded-For", "X-Client-Region"
	cases := []struct {
		name    string
		proxies Proxies
		r       *http.Request
		want    string
	}{
		{"through the proxy", behind, request("10.1.2.3:5", fwd, "203.0.113.9", region, "IN"), "IN"},
		{"no proxies configured", Proxies{}, request("10.1.2.3:5", fwd, "203.0.113.9", region, "IN"), ""},
		{"no forwarded hop, so not through the proxy", behind, request("203.0.113.9:5", region, "IN"), ""},
		{"an empty forwarded header is no hop", behind, request("10.1.2.3:5", fwd, " ", region, "IN"), ""},
		{"too few hops", Proxies{Count: 2}, request("10.1.2.3:5", fwd, "203.0.113.9", region, "IN"), ""},
		{"peer inside the proxy network", inNetwork, request("10.1.2.3:5", fwd, "203.0.113.9", region, "DE"), "DE"},
		{"peer outside the proxy network", inNetwork, request("198.51.100.7:5", fwd, "203.0.113.9", region, "DE"), ""},
		{"lower case", behind, request("10.1.2.3:5", fwd, "203.0.113.9", region, "in"), ""},
		{"three letters", behind, request("10.1.2.3:5", fwd, "203.0.113.9", region, "IND"), ""},
		{"unknown", behind, request("10.1.2.3:5", fwd, "203.0.113.9", region, "XX"), ""},
		{"sent twice", behind, request("10.1.2.3:5", fwd, "203.0.113.9", region, "IN", region, "US"), ""},
		{"absent", behind, request("10.1.2.3:5", fwd, "203.0.113.9"), ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Country(c.r, region, c.proxies); got != c.want {
				t.Errorf("Country = %q, want %q", got, c.want)
			}
		})
	}
	if got := Country(request("10.1.2.3:5", fwd, "203.0.113.9", region, "IN"), "", behind); got != "" {
		t.Errorf("Country with no header name = %q, want empty", got)
	}
}

func TestLimiter(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	l, err := NewLimiter(2, 3, time.Hour, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	for i := range 2 {
		if ok, _ := l.Allow("203.0.113.9"); !ok {
			t.Fatalf("report %d was refused", i+1)
		}
	}
	ok, wait := l.Allow("203.0.113.9")
	if ok || wait != time.Hour {
		t.Fatalf("third report from one client: allowed=%v wait=%v, want refused for an hour", ok, wait)
	}
	if ok, _ := l.Allow("198.51.100.7"); !ok {
		t.Fatal("another client was refused")
	}
	if ok, _ := l.Allow("192.0.2.1"); ok {
		t.Fatal("the global cap of 3 let a fourth report through")
	}
	now = now.Add(time.Hour)
	if ok, _ := l.Allow("203.0.113.9"); !ok {
		t.Fatal("the window ended but the client is still refused")
	}
}

func TestLimiterForgetsClientsAndKeepsNoAddress(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	l, err := NewLimiter(5, 100, time.Hour, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		l.Allow(fmt.Sprintf("203.0.113.%d", i))
	}
	for key := range l.clients {
		if bytes.Contains(key[:], []byte("203.0.113")) {
			t.Fatal("a limiter key holds the address")
		}
	}
	other, _ := NewLimiter(5, 100, time.Hour, func() time.Time { return now })
	if l.client("203.0.113.0") == other.client("203.0.113.0") {
		t.Fatal("two limiters gave one address the same key, so the key is not random")
	}
	now = now.Add(time.Hour)
	l.Sweep()
	if l.Size() != 0 {
		t.Fatalf("after the window the limiter still holds %d clients", l.Size())
	}
}

func TestNewLimiterRefusesZero(t *testing.T) {
	if _, err := NewLimiter(0, 1, time.Hour, time.Now); err == nil {
		t.Fatal("a per-client limit of 0 was accepted")
	}
}
