package adminapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Token is one entry under tokens: in the configuration. The name becomes the
// actor on the timeline. SHA256 is the hex hash of a high-entropy secret, so the
// configuration holds nothing that can be used to sign in. The hash has no salt
// and is fast, which is why the secret must be random rather than a password.
type Token struct {
	Name   string `yaml:"name"`
	SHA256 string `yaml:"sha256"`
}

type token struct {
	name string
	hash [sha256.Size]byte
}

var tokenName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@-]{0,99}$`)

func parseTokens(tokens []Token) ([]token, error) {
	parsed := make([]token, 0, len(tokens))
	seen := map[string]bool{}
	for i, t := range tokens {
		if !tokenName.MatchString(t.Name) {
			return nil, fmt.Errorf("token %d: name must be letters, digits, or . _ @ -, up to 100 characters", i)
		}
		raw, err := hex.DecodeString(t.SHA256)
		if err != nil || len(raw) != sha256.Size {
			return nil, fmt.Errorf("token %s: sha256 must be 64 hex characters", t.Name)
		}
		hash := strings.ToLower(t.SHA256)
		if seen[t.Name] || seen[hash] {
			return nil, fmt.Errorf("token %s: names and hashes must be unique", t.Name)
		}
		seen[t.Name], seen[hash] = true, true
		parsed = append(parsed, token{name: t.Name, hash: [sha256.Size]byte(raw)})
	}
	return parsed, nil
}

// authenticate returns the actor for a valid bearer token. It compares against
// every token each time, so timing says nothing about which one came close.
func (a *API) authenticate(r *http.Request) (string, bool) {
	scheme, presented, found := strings.Cut(r.Header.Get("Authorization"), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || presented == "" {
		return "", false
	}
	hash := sha256.Sum256([]byte(presented))
	actor := ""
	matched := 0
	for i := range a.tokens {
		if subtle.ConstantTimeCompare(hash[:], a.tokens[i].hash[:]) == 1 {
			actor = a.tokens[i].name
			matched = 1
		}
	}
	return actor, matched == 1
}

// clientAddress returns the address to rate limit. With trusted proxies in front,
// the connection comes from the nearest proxy, and each proxy appends the address
// it saw, so the client is that many places from the end of X-Forwarded-For.
// Anything further left is written by the client and proves nothing.
func (a *API) clientAddress(r *http.Request) string {
	address := r.RemoteAddr
	if host, _, err := net.SplitHostPort(address); err == nil {
		address = host
	}
	if a.trustedProxies > 0 {
		hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		if i := len(hops) - a.trustedProxies; i >= 0 {
			address = strings.TrimSpace(hops[i])
		}
	}
	parsed, err := netip.ParseAddr(address)
	if err != nil {
		return address
	}
	parsed = parsed.Unmap()
	if parsed.Is6() {
		// One IPv6 user usually holds a whole /64, so that is the client.
		prefix, err := parsed.WithZone("").Prefix(64)
		if err == nil {
			return prefix.String()
		}
	}
	return parsed.String()
}

const (
	maxFailures   = 10
	failureWindow = time.Minute
	// maxClients bounds memory when many addresses fail at once. The shared
	// overflow entry is one more.
	maxClients = 10_000
	// overflowClient is shared by addresses that arrive once the table is full, so
	// a flood of addresses gets less room rather than more.
	overflowClient = "overflow"
)

type failures struct {
	count   int
	expires time.Time
}

// limiter counts failed sign-ins per client over a fixed window.
type limiter struct {
	now       func() time.Time
	mu        sync.Mutex
	clients   map[string]*failures
	nextSweep time.Time
}

func newLimiter(now func() time.Time) *limiter {
	return &limiter{now: now, clients: make(map[string]*failures)}
}

// wait returns how long a client must stay away, or zero if it may try.
func (l *limiter) wait(client string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	entry, ok := l.clients[client]
	if !ok {
		if entry, ok = l.clients[overflowClient]; !ok || len(l.clients) < maxClients {
			return 0
		}
	}
	if entry.count < maxFailures || !now.Before(entry.expires) {
		return 0
	}
	return entry.expires.Sub(now)
}

// fail records a failed attempt.
func (l *limiter) fail(client string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if _, known := l.clients[client]; !known && len(l.clients) >= maxClients {
		if !now.Before(l.nextSweep) {
			// At most once a window, so that a flood cannot make every failure scan the table.
			l.nextSweep = now.Add(failureWindow)
			for key, entry := range l.clients {
				if !now.Before(entry.expires) {
					delete(l.clients, key)
				}
			}
		}
		if len(l.clients) >= maxClients {
			client = overflowClient
		}
	}
	entry, ok := l.clients[client]
	if !ok || !now.Before(entry.expires) {
		entry = &failures{expires: now.Add(failureWindow)}
		l.clients[client] = entry
	}
	entry.count++
}
