package ui

import (
	"bytes"
	"encoding/json"
	"errors"
	"html/template"
	"reflect"
	"strings"
	"testing"
)

func TestValidateAndSetDefaults_LogoDarkAndBrowserChecks(t *testing.T) {
	six := make([]Button, 6)
	for i := range six {
		six[i] = Button{Name: "Page", Link: "https://example.org/"}
	}
	scenarios := []struct {
		name        string
		cfg         Config
		expectedErr error
	}{
		{name: "none", cfg: Config{}},
		{name: "dark-logo-path", cfg: Config{LogoDark: "/mark-dark.svg"}},
		{name: "dark-logo-script", cfg: Config{LogoDark: "javascript:alert(1)"}, expectedErr: ErrInvalidLogoDark},
		{name: "checks", cfg: Config{BrowserChecks: []Button{{Name: "Home", Link: "https://pralvo.com/"}, {Name: "Images", Link: "https://media.pralvo.com/"}}}},
		{name: "check-over-http", cfg: Config{BrowserChecks: []Button{{Name: "Home", Link: "http://pralvo.com/"}}}, expectedErr: ErrInvalidBrowserCheck},
		{name: "check-path", cfg: Config{BrowserChecks: []Button{{Name: "Home", Link: "/"}}}, expectedErr: ErrInvalidBrowserCheck},
		{name: "check-with-credentials", cfg: Config{BrowserChecks: []Button{{Name: "Home", Link: "https://user:pass@pralvo.com/"}}}, expectedErr: ErrInvalidBrowserCheck},
		{name: "check-without-name", cfg: Config{BrowserChecks: []Button{{Name: " ", Link: "https://pralvo.com/"}}}, expectedErr: ErrInvalidBrowserCheck},
		{name: "too-many-checks", cfg: Config{BrowserChecks: six}, expectedErr: ErrInvalidBrowserCheck},
		{name: "location", cfg: Config{ChecksLocation: "one location in India"}},
		{name: "location-two-lines", cfg: Config{ChecksLocation: "India\nand more"}, expectedErr: ErrInvalidChecksLocation},
		{name: "location-too-long", cfg: Config{ChecksLocation: strings.Repeat("a", 121)}, expectedErr: ErrInvalidChecksLocation},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			cfg := scenario.cfg
			if err := cfg.ValidateAndSetDefaults(); !errors.Is(err, scenario.expectedErr) {
				t.Fatalf("expected %v, got %v", scenario.expectedErr, err)
			}
		})
	}
}

func TestPageSettingsListsAreNeverNull(t *testing.T) {
	cfg := GetDefaultConfig()
	out, err := json.Marshal(cfg.PageSettings())
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"buttons":[]`, `"footerLinks":[]`, `"browserChecks":[]`, `"feeds":false`, `"sourceLink":"https://github.com/TwiN/gatus"`, `"checksLocation":""`} {
		if !strings.Contains(string(out), field) {
			t.Errorf("missing %s in %s", field, out)
		}
	}
}

func TestConnectSourcesAreDistinctOrigins(t *testing.T) {
	cfg := Config{BrowserChecks: []Button{
		{Name: "Home", Link: "https://pralvo.com/"},
		{Name: "Blog", Link: "https://pralvo.com/blog/"},
		{Name: "Images", Link: "https://media.pralvo.com/a.png"},
	}}
	if got, want := cfg.ConnectSources(), []string{"https://pralvo.com", "https://media.pralvo.com"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

// The page writes the settings into a <script type="application/json"> block.
// Hostile text must stay inside its JSON string.
func TestPageConfigIsEscapedInsideItsDataBlock(t *testing.T) {
	cfg := GetDefaultConfig()
	cfg.Header = `Status</script><script>alert(1)</script>`
	page := template.Must(template.New("page").Parse(`<script type="application/json" id="page-config">{{ .PageConfig }}</script>`))
	var out bytes.Buffer
	if err := page.Execute(&out, ViewData{UI: cfg}); err != nil {
		t.Fatal(err)
	}
	html := out.String()
	if strings.Count(html, "</script>") != 1 || strings.Contains(html, "<script>alert") {
		t.Fatalf("the header escaped its data block: %s", html)
	}
	body := strings.TrimSuffix(strings.TrimPrefix(html, `<script type="application/json" id="page-config">`), "</script>")
	var settings PageSettings
	if err := json.Unmarshal([]byte(body), &settings); err != nil {
		t.Fatalf("the data block is not JSON: %v\n%s", err, body)
	}
	if settings.Header != cfg.Header {
		t.Fatalf("header %q came back as %q", cfg.Header, settings.Header)
	}
}

func TestContentSecurityPolicyAllowsOnlyWhatThePageUses(t *testing.T) {
	cfg := Config{
		Logo:          "https://status.pralvo.com/pralvo-mark.svg",
		LogoDark:      "/pralvo-mark-dark.svg",
		BrowserChecks: []Button{{Name: "pralvo.com", Link: "https://pralvo.com/"}, {Name: "Images", Link: "https://media.pralvo.com/"}},
	}
	policy := cfg.ContentSecurityPolicy()
	for _, want := range []string{
		"script-src 'self';",
		"style-src 'self';",
		"img-src 'self' data: https://status.pralvo.com;",
		"connect-src 'self' https://pralvo.com https://media.pralvo.com;",
		"frame-ancestors 'none'",
		"object-src 'none'",
	} {
		if !strings.Contains(policy, want) {
			t.Errorf("missing %q in %s", want, policy)
		}
	}
	if strings.Contains(policy, "unsafe") {
		t.Errorf("the policy allows unsafe sources: %s", policy)
	}
	if got := (&Config{}).ContentSecurityPolicy(); !strings.Contains(got, "connect-src 'self';") || !strings.Contains(got, "img-src 'self' data:;") {
		t.Errorf("default policy: %s", got)
	}
}

// The page reads lower-case "name" and "link"; any other spelling makes it drop
// every footer link, button and browser check as malformed.
func TestPageSettingsLinksUseThePagesFieldNames(t *testing.T) {
	cfg := GetDefaultConfig()
	cfg.FooterLinks = []Button{{Name: "Pralvo", Link: "https://pralvo.com/"}}
	cfg.BrowserChecks = []Button{{Name: "Website", Link: "https://pralvo.com/"}}
	out, err := json.Marshal(cfg.PageSettings())
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`"footerLinks":[{"name":"Pralvo","link":"https://pralvo.com/"}]`,
		`"browserChecks":[{"name":"Website","link":"https://pralvo.com/"}]`,
	} {
		if !strings.Contains(string(out), want) {
			t.Errorf("missing %s in %s", want, out)
		}
	}
}
