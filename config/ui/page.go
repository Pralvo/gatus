package ui

import (
	"errors"
	"net/url"
	"strings"
)

// maxChecksLocation keeps the sentence short; it is plain text.
const maxChecksLocation = 120

// maxBrowserChecks keeps the visitor's own check short and the page's
// connect-src list small.
const maxBrowserChecks = 5

var (
	ErrInvalidLogoDark       = errors.New("invalid logo-dark value: must start with https://, http:// or /")
	ErrInvalidBrowserCheck   = errors.New("invalid browser-checks entry: needs a name and an https:// link, and at most 5 entries")
	ErrInvalidChecksLocation = errors.New("invalid checks-location value: at most 120 characters on one line")
)

// PageSettings is what the page's own scripts read, written into the page as a
// JSON data block. It holds only what the page shows; nothing here is secret.
type PageSettings struct {
	Header                 string   `json:"header"`
	Logo                   string   `json:"logo"`
	LogoDark               string   `json:"logoDark"`
	Link                   string   `json:"link"`
	Buttons                []Button `json:"buttons"`
	MaximumNumberOfResults int      `json:"maximumNumberOfResults"`
	DefaultSortBy          string   `json:"defaultSortBy"`
	DefaultFilterBy        string   `json:"defaultFilterBy"`
	FooterLinks            []Button `json:"footerLinks"`
	SourceLink             string   `json:"sourceLink"`
	Feeds                  bool     `json:"feeds"`
	BrowserChecks          []Button `json:"browserChecks"`
	ChecksLocation         string   `json:"checksLocation"`
}

// PageSettings returns the settings the page reads. Lists are never null, so
// the page needs no special case for them.
func (cfg *Config) PageSettings() PageSettings {
	return PageSettings{
		Header:                 cfg.Header,
		Logo:                   cfg.Logo,
		LogoDark:               cfg.LogoDark,
		Link:                   cfg.Link,
		Buttons:                nonNil(cfg.Buttons),
		MaximumNumberOfResults: cfg.MaximumNumberOfResults,
		DefaultSortBy:          cfg.DefaultSortBy,
		DefaultFilterBy:        cfg.DefaultFilterBy,
		FooterLinks:            nonNil(cfg.FooterLinks),
		SourceLink:             cfg.SourceLink,
		Feeds:                  cfg.Feeds,
		BrowserChecks:          nonNil(cfg.BrowserChecks),
		ChecksLocation:         cfg.ChecksLocation,
	}
}

// ConnectSources lists the origins of the browser checks, for the page's
// Content-Security-Policy connect-src. Each origin appears once.
func (cfg *Config) ConnectSources() []string {
	seen := map[string]bool{}
	var origins []string
	for _, check := range cfg.BrowserChecks {
		parsed, err := url.Parse(check.Link)
		if err != nil {
			continue // validated on start, so this does not happen
		}
		origin := parsed.Scheme + "://" + parsed.Host
		if !seen[origin] {
			seen[origin] = true
			origins = append(origins, origin)
		}
	}
	return origins
}

// ContentSecurityPolicy is the policy for pages that run the app. Scripts and
// styles come only from this site. The browser checks' origins may be fetched,
// and an absolute logo's origin may be shown.
func (cfg *Config) ContentSecurityPolicy() string {
	images := []string{"'self'", "data:"}
	for _, logo := range []string{cfg.Logo, cfg.LogoDark} {
		if origin := originOf(logo); origin != "" && !contains(images, origin) {
			images = append(images, origin)
		}
	}
	connect := append([]string{"'self'"}, cfg.ConnectSources()...)
	return "default-src 'self'; script-src 'self'; style-src 'self'; img-src " + strings.Join(images, " ") +
		"; font-src 'self'; connect-src " + strings.Join(connect, " ") +
		"; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
}

// originOf gives scheme://host for an absolute http(s) address, and "" for a path.
func originOf(link string) string {
	parsed, err := url.Parse(link)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// PageConfig lets the page template write {{ .PageConfig }}.
func (v ViewData) PageConfig() PageSettings {
	return v.UI.PageSettings()
}

func (cfg *Config) validatePageSettings() error {
	if cfg.LogoDark != "" && !isPageLink(cfg.LogoDark) {
		return ErrInvalidLogoDark
	}
	if len([]rune(cfg.ChecksLocation)) > maxChecksLocation || strings.ContainsAny(cfg.ChecksLocation, "\r\n") {
		return ErrInvalidChecksLocation
	}
	if len(cfg.BrowserChecks) > maxBrowserChecks {
		return ErrInvalidBrowserCheck
	}
	for _, check := range cfg.BrowserChecks {
		parsed, err := url.Parse(check.Link)
		if strings.TrimSpace(check.Name) == "" || err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
			return ErrInvalidBrowserCheck
		}
	}
	return nil
}

func nonNil(buttons []Button) []Button {
	if buttons == nil {
		return []Button{}
	}
	return buttons
}
