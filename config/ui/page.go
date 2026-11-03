package ui

import (
	"errors"
	"net/url"
	"strings"
)

// maxBrowserChecks keeps the visitor's own check short and the page's
// connect-src list small.
const maxBrowserChecks = 5

var (
	ErrInvalidLogoDark     = errors.New("invalid logo-dark value: must start with https://, http:// or /")
	ErrInvalidBrowserCheck = errors.New("invalid browser-checks entry: needs a name and an https:// link, and at most 5 entries")
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

// PageConfig lets the page template write {{ .PageConfig }}.
func (v ViewData) PageConfig() PageSettings {
	return v.UI.PageSettings()
}

func (cfg *Config) validatePageSettings() error {
	if cfg.LogoDark != "" && !isPageLink(cfg.LogoDark) {
		return ErrInvalidLogoDark
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
