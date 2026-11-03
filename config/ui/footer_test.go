package ui

import (
	"bytes"
	"errors"
	"html/template"
	"strings"
	"testing"

	static "github.com/TwiN/gatus/v5/web"
)

func TestConfig_ValidateAndSetDefaults_FooterLinks(t *testing.T) {
	scenarios := []struct {
		name        string
		links       []Button
		expectedErr error
	}{
		{name: "none", links: nil},
		{name: "web-addresses-and-paths", links: []Button{{Name: "Pralvo", Link: "https://pralvo.com/"}, {Name: "Plain", Link: "http://example.org"}, {Name: "Reports", Link: "/reports"}}},
		{name: "missing-name", links: []Button{{Link: "https://pralvo.com/"}}, expectedErr: ErrInvalidFooterLink},
		{name: "missing-link", links: []Button{{Name: "Pralvo"}}, expectedErr: ErrInvalidFooterLink},
		{name: "script-link", links: []Button{{Name: "Pralvo", Link: "javascript:alert(1)"}}, expectedErr: ErrInvalidFooterLink},
		{name: "relative-link", links: []Button{{Name: "Pralvo", Link: "pralvo.com"}}, expectedErr: ErrInvalidFooterLink},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			cfg := &Config{FooterLinks: scenario.links}
			if err := cfg.ValidateAndSetDefaults(); !errors.Is(err, scenario.expectedErr) {
				t.Fatalf("expected error %v, got %v", scenario.expectedErr, err)
			}
		})
	}
}

func TestConfig_ValidateAndSetDefaults_SourceLink(t *testing.T) {
	scenarios := []struct {
		name        string
		link        string
		expected    string
		expectedErr error
	}{
		{name: "default", link: "", expected: defaultSourceLink},
		{name: "fork", link: "https://github.com/Pralvo/gatus", expected: "https://github.com/Pralvo/gatus"},
		{name: "script-link", link: "javascript:alert(1)", expectedErr: ErrInvalidSourceLink},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			cfg := &Config{SourceLink: scenario.link}
			err := cfg.ValidateAndSetDefaults()
			if !errors.Is(err, scenario.expectedErr) {
				t.Fatalf("expected error %v, got %v", scenario.expectedErr, err)
			}
			if err == nil && cfg.SourceLink != scenario.expected {
				t.Errorf("expected source link %q, got %q", scenario.expected, cfg.SourceLink)
			}
		})
	}
	if GetDefaultConfig().SourceLink != defaultSourceLink {
		t.Error("the default config should link the GitHub icon to upstream Gatus")
	}
}

// The page template puts footer links into a script, so a hostile name must stay a string.
func TestFooterLinks_RenderedAsEscapedStrings(t *testing.T) {
	cfg := &Config{
		FooterLinks: []Button{{Name: `Pralvo"</script><script>alert(1)</script>`, Link: "https://pralvo.com/"}},
		SourceLink:  "https://github.com/Pralvo/gatus",
	}
	if err := cfg.ValidateAndSetDefaults(); err != nil {
		t.Fatal(err)
	}
	page, err := template.ParseFS(static.FileSystem, static.IndexPath)
	if err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	if err := page.Execute(&buffer, ViewData{UI: cfg, Theme: "dark"}); err != nil {
		t.Fatal(err)
	}
	html := buffer.String()
	if !strings.Contains(html, "window.config.footerLinks.push({name:") {
		t.Error("expected the page to pass footer links to the app")
	}
	if !strings.Contains(html, `sourceLink: "https:\/\/github.com\/Pralvo\/gatus"`) {
		t.Error("expected the page to pass the source link to the app")
	}
	if strings.Contains(html, "<script>alert(1)") {
		t.Error("a footer link name broke out of its string")
	}
}
