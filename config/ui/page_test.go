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
	for _, field := range []string{`"buttons":[]`, `"footerLinks":[]`, `"browserChecks":[]`, `"feeds":false`, `"sourceLink":"https://github.com/TwiN/gatus"`} {
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
