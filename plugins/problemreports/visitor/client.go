package visitor

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Proxies describes the proxies in front of Gatus. A header a proxy adds, such as
// a country code, is believed only for requests that came through them.
type Proxies struct {
	// Count is how many proxies append to X-Forwarded-For before Gatus.
	Count int
	// Networks, when set, are where the nearest proxy connects from.
	Networks []netip.Prefix
}

// Through reports whether the request came through the proxies: it carries at
// least Count forwarded hops and, when Networks are set, it arrived from one.
func (p Proxies) Through(r *http.Request) bool {
	if p.Count <= 0 {
		return false
	}
	hops := 0
	for _, value := range r.Header.Values("X-Forwarded-For") {
		for _, hop := range strings.Split(value, ",") {
			if strings.TrimSpace(hop) != "" {
				hops++
			}
		}
	}
	if hops < p.Count {
		return false
	}
	if len(p.Networks) == 0 {
		return true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	peer = peer.Unmap()
	for _, network := range p.Networks {
		if network.Contains(peer) {
			return true
		}
	}
	return false
}

var countryCode = regexp.MustCompile(`^[A-Z]{2}$`)

// Country returns the ISO 3166-1 alpha-2 code a trusted proxy put in header, or
// "" when there is no header name, the request did not come through the proxies,
// the header appears more than once, or its value is not two capital letters.
// "XX", which some proxies send for an unknown country, is also "".
func Country(r *http.Request, header string, proxies Proxies) string {
	if header == "" || !proxies.Through(r) {
		return ""
	}
	values := r.Header.Values(header)
	if len(values) != 1 {
		return ""
	}
	value := strings.TrimSpace(values[0])
	if !countryCode.MatchString(value) || value == "XX" {
		return ""
	}
	return value
}

// maxClients bounds the limiter's memory. Clients that arrive when it is full
// share one entry, so a flood of addresses gets less room rather than more.
const maxClients = 50_000

type count struct {
	n       int
	expires time.Time
}

// Limiter counts reports per client and in total over a fixed window. A client
// is known only by HMAC-SHA256 of its address under a key made when the limiter
// is made. The key is never stored or logged, so the entries cannot be turned
// back into addresses after the process ends, and they expire with the window.
type Limiter struct {
	key       [32]byte
	perClient int
	global    int
	window    time.Duration
	now       func() time.Time

	mu        sync.Mutex
	clients   map[[sha256.Size]byte]*count
	total     count
	nextSweep time.Time
}

// NewLimiter returns a limiter that allows perClient reports per client and
// global reports in all per window.
func NewLimiter(perClient, global int, window time.Duration, now func() time.Time) (*Limiter, error) {
	if perClient < 1 || global < 1 || window <= 0 {
		return nil, errors.New("limits and the window must be positive")
	}
	l := &Limiter{perClient: perClient, global: global, window: window, now: now, clients: map[[sha256.Size]byte]*count{}}
	if _, err := rand.Read(l.key[:]); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *Limiter) client(address string) [sha256.Size]byte {
	mac := hmac.New(sha256.New, l.key[:])
	_, _ = mac.Write([]byte(address))
	return [sha256.Size]byte(mac.Sum(nil))
}

// Allow records a report from address and says whether it may go ahead, or how
// long to wait. A refused report is not counted.
func (l *Limiter) Allow(address string) (bool, time.Duration) {
	key := l.client(address)
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if !now.Before(l.total.expires) {
		l.total = count{expires: now.Add(l.window)}
	}
	if l.total.n >= l.global {
		return false, l.total.expires.Sub(now)
	}
	entry := l.entry(key, now)
	if entry.n >= l.perClient {
		return false, entry.expires.Sub(now)
	}
	entry.n++
	l.total.n++
	return true, 0
}

var overflow = [sha256.Size]byte{}

func (l *Limiter) entry(key [sha256.Size]byte, now time.Time) *count {
	if !now.Before(l.nextSweep) {
		// At most once a window, so a flood cannot make every request scan the table.
		l.sweep(now)
	}
	if _, known := l.clients[key]; !known && len(l.clients) >= maxClients {
		key = overflow
	}
	entry, ok := l.clients[key]
	if !ok || !now.Before(entry.expires) {
		entry = &count{expires: now.Add(l.window)}
		l.clients[key] = entry
	}
	return entry
}

// Sweep forgets every client whose window has ended. The plugin runs it on a
// timer, so no entry outlives its window by more than the timer's interval.
func (l *Limiter) Sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweep(l.now())
}

func (l *Limiter) sweep(now time.Time) {
	l.nextSweep = now.Add(l.window)
	for k, entry := range l.clients {
		if !now.Before(entry.expires) {
			delete(l.clients, k)
		}
	}
}

// Size is how many clients the limiter holds, for tests.
func (l *Limiter) Size() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.clients)
}
