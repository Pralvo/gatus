// Package problemreports lets visitors report a problem from the status page.
// It is off unless listed in the configuration, and it refuses to start without
// a privacy notice address and a contact, so it cannot collect anything before
// the people sending reports can read what happens to them.
//
// A report keeps what the visitor typed, when it arrived, a country code from a
// trusted proxy, and a coarse browser and system. It never keeps an address, a
// raw User-Agent, a cookie or anything that identifies a device. The address is
// used only in memory, for the rate limit. docs/privacy/problem-reports.md lists
// every field.
package problemreports

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/incidents/adminapi"
	"github.com/TwiN/gatus/v5/plugins/problemreports/httpapi"
	"github.com/TwiN/gatus/v5/plugins/problemreports/store"
	"github.com/TwiN/gatus/v5/plugins/problemreports/visitor"
)

const (
	day              = 24 * time.Hour
	defaultRetention = 90 * day
	maxRetention     = 365 * day
	// limitWindow is the rate limit's window, and how often old reports are purged.
	limitWindow  = time.Hour
	retryDelay   = 30 * time.Second
	purgeTimeout = time.Minute
)

// Config is the plugin's config: block.
type Config struct {
	// PrivacyURL is the notice the form links to: an https address or a path on
	// this site. Required.
	PrivacyURL string `yaml:"privacy-url"`
	// Contact is an email address or an https address for privacy requests. Required.
	Contact string `yaml:"contact"`
	// Retention is how long a report is kept: default 90 days, at most 365.
	Retention time.Duration `yaml:"retention"`
	// CountryHeader names the request header a trusted proxy puts the visitor's
	// country code in. Empty keeps no country.
	CountryHeader string `yaml:"country-header"`
	// TrustedProxies is how many proxies sit in front of Gatus.
	TrustedProxies int `yaml:"trusted-proxies"`
	// ProxyNetworks, when set, are the networks the nearest proxy connects from.
	ProxyNetworks []string `yaml:"proxy-networks"`
	// PerClientLimit is how many reports one client may send an hour; default 5.
	PerClientLimit int `yaml:"per-client-limit"`
	// GlobalLimit is how many reports everyone together may send an hour; default 200.
	GlobalLimit int `yaml:"global-limit"`
	// Tokens may read and delete reports. Use the incidents plugin's entries to
	// use the same token on the admin page.
	Tokens []adminapi.Token `yaml:"tokens"`
}

func init() { plugin.Register(Definition) }

// now is the plugin's clock, a variable so that tests can move it.
var now = time.Now

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "problem-reports",
	Description: "A form for visitors to report a problem, with a token API to read and delete reports.",
	Needs:       []plugin.Key{database.Key, plugin.CoreConfig},
	Start:       start,
}

func start(ctx *plugin.Context) error {
	cfg := Config{Retention: defaultRetention, PerClientLimit: 5, GlobalLimit: 200}
	if err := ctx.Decode(&cfg); err != nil {
		return err
	}
	proxies, err := cfg.validate()
	if err != nil {
		return err
	}
	limiter, err := visitor.NewLimiter(cfg.PerClientLimit, cfg.GlobalLimit, limitWindow, now)
	if err != nil {
		return err
	}
	gate, err := adminapi.NewGate(cfg.Tokens, cfg.TrustedProxies, now)
	if err != nil {
		return err
	}
	if len(cfg.Tokens) == 0 {
		ctx.Logf("no tokens are configured, so reports can be sent but not read")
	}
	db := plugin.Get[*database.DB](ctx, database.Key)
	reports := store.New(db)
	if err := migrate(ctx.Context(), reports, db); err != nil {
		return err
	}
	purge := func(c context.Context) error {
		c, cancel := context.WithTimeout(c, purgeTimeout)
		defer cancel()
		limiter.Sweep()
		n, err := reports.Purge(c, now().Add(-cfg.Retention))
		if n > 0 {
			ctx.Logf("deleted %d reports older than the retention period", n)
		}
		return err
	}
	if err := purge(ctx.Context()); err != nil {
		ctx.Logf("purge: %s", err.Error()) // the job tries again within the hour
	}
	ctx.Every("purge", limitWindow, purge)
	public := &httpapi.Public{
		Store:         reports,
		Settings:      httpapi.Settings{PrivacyURL: cfg.PrivacyURL, Contact: cfg.Contact, RetentionDays: int(cfg.Retention / day)},
		Known:         services(plugin.Get[*config.Config](ctx, plugin.CoreConfig)),
		Limiter:       limiter,
		CountryHeader: cfg.CountryHeader,
		Proxies:       proxies,
		Now:           now,
		Logf:          ctx.Logf,
	}
	public.Register(ctx.HandleFunc)
	admin := &httpapi.Admin{Store: reports, Gate: gate, Now: now, Logf: ctx.Logf}
	admin.Register(ctx.HandleFunc)
	return nil
}

// validate checks the settings and returns the proxies to trust.
func (c *Config) validate() (visitor.Proxies, error) {
	var proxies visitor.Proxies
	if !validPrivacyURL(c.PrivacyURL) {
		return proxies, errors.New("privacy-url is required: the https address of the privacy notice, or a path on this site such as /privacy")
	}
	if !validContact(c.Contact) {
		return proxies, errors.New("contact is required: an email address or an https address for privacy requests")
	}
	if c.Retention < day || c.Retention > maxRetention {
		return proxies, errors.New("retention must be from 24h to 8760h (365 days)")
	}
	if c.TrustedProxies < 0 {
		return proxies, errors.New("trusted-proxies cannot be negative")
	}
	if c.CountryHeader != "" {
		if c.TrustedProxies == 0 {
			return proxies, errors.New("country-header needs trusted-proxies: a country is believed only from a proxy")
		}
		if !validHeaderName(c.CountryHeader) {
			return proxies, fmt.Errorf("country-header %q is not a header name", c.CountryHeader)
		}
	}
	if c.PerClientLimit < 1 || c.GlobalLimit < c.PerClientLimit {
		return proxies, errors.New("per-client-limit must be at least 1, and global-limit at least per-client-limit")
	}
	proxies.Count = c.TrustedProxies
	for _, network := range c.ProxyNetworks {
		prefix, err := netip.ParsePrefix(network)
		if err != nil {
			return proxies, fmt.Errorf("proxy-networks: %q is not a network such as 10.0.0.0/8", network)
		}
		proxies.Networks = append(proxies.Networks, prefix.Masked())
	}
	return proxies, nil
}

func validPrivacyURL(value string) bool {
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
		return !strings.ContainsAny(value, "\\ \t\r\n")
	}
	return validHTTPS(value)
}

func validHTTPS(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil && !strings.ContainsAny(value, " \t\r\n")
}

func validContact(value string) bool {
	if validHTTPS(value) {
		return true
	}
	address, err := mail.ParseAddress(value)
	return err == nil && address.Name == "" && address.Address == value
}

func validHeaderName(name string) bool {
	for _, c := range name {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return name != "" && http.CanonicalHeaderKey(name) != ""
}

// services returns the check for a report's service: an endpoint, external
// endpoint or suite key, or a group name, as the page shows them.
func services(cfg *config.Config) func(string) bool {
	known := map[string]bool{}
	for _, e := range cfg.Endpoints {
		known[e.Key()], known[e.Group] = true, true
	}
	for _, e := range cfg.ExternalEndpoints {
		known[e.Key()], known[e.Group] = true, true
	}
	for _, s := range cfg.Suites {
		known[s.Key()], known[s.Group] = true, true
	}
	delete(known, "")
	return func(key string) bool { return known[key] }
}

// migrate retries only when the database itself is unreachable.
func migrate(ctx context.Context, reports *store.Store, db *database.DB) error {
	err := reports.Migrate()
	if err == nil {
		return nil
	}
	checking, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if db.SQL().PingContext(checking) != nil {
		return plugin.Retry(err, retryDelay)
	}
	return err
}
