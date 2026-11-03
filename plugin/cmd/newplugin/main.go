// Command newplugin generates a working plugin, its test and its registration.
//
//	make plugin NAME=my-plugin
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const modulePath = "github.com/TwiN/gatus/v5"

var namePattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: make plugin NAME=my-plugin")
		os.Exit(2)
	}
	if err := generate(".", os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, "newplugin:", err)
		os.Exit(1)
	}
	fmt.Printf("Created plugins/%s. Add it under plugins: in your configuration.\n", packageName(os.Args[1]))
}

// packageName turns a plugin name into a Go package name.
func packageName(name string) string { return strings.ReplaceAll(name, "-", "") }

// generate writes the plugin under root and registers it. It refuses to touch an
// existing plugin, so running it twice cannot overwrite work.
func generate(root, name string) error {
	if !namePattern.MatchString(name) {
		return fmt.Errorf("name %q must match %s", name, namePattern)
	}
	pkg := packageName(name)
	dir := filepath.Join(root, "plugins", pkg)
	if _, err := os.Stat(dir); err == nil {
		return fmt.Errorf("%s already exists", dir)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	replacer := strings.NewReplacer("{{name}}", name, "{{pkg}}", pkg, "{{module}}", modulePath)
	files := map[string]string{pkg + ".go": pluginTemplate, pkg + "_test.go": testTemplate}
	for file, template := range files {
		if err := os.WriteFile(filepath.Join(dir, file), []byte(replacer.Replace(template)), 0o644); err != nil {
			return err
		}
	}
	return register(filepath.Join(root, "plugins", "all", "all.go"), pkg)
}

// register adds the import to all.go, keeping the list sorted so that two
// branches adding plugins make a small, readable merge.
func register(path, pkg string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	text := string(data)
	start := strings.Index(text, "import (\n")
	end := strings.LastIndex(text, ")")
	if start < 0 || end < start {
		return fmt.Errorf("%s has no import block", path)
	}
	body := text[start+len("import (\n") : end]
	lines := []string{fmt.Sprintf("\t_ \"%s/plugins/%s\"", modulePath, pkg)}
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, line)
		}
	}
	sort.Strings(lines)
	updated := text[:start] + "import (\n" + strings.Join(lines, "\n") + "\n" + text[end:]
	return os.WriteFile(path, []byte(updated), 0o644)
}

const pluginTemplate = `// Package {{pkg}} is a plugin. Describe what it does here.
package {{pkg}}

import (
	"net/http"

	"{{module}}/plugin"
)

// Config is read from the plugin's config: block. Unknown fields are refused.
type Config struct {
	Message string ` + "`yaml:\"message\"`" + `
}

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "{{name}}",
	Description: "Describe this plugin in one line.",
	Start: func(ctx *plugin.Context) error {
		cfg := Config{Message: "hello from {{name}}"}
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		ctx.HandleFunc("GET /plugins/{{name}}", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(cfg.Message))
		})
		return nil
	},
}
`

const testTemplate = `package {{pkg}}

import (
	"net/http"
	"testing"

	"{{module}}/plugin/plugintest"
)

func TestRouteUsesConfig(t *testing.T) {
	h := plugintest.Start(t, Definition, "message: configured", nil)
	response := h.Get("/plugins/{{name}}")
	if response.Code != http.StatusOK || response.Body.String() != "configured" {
		t.Fatalf("got %d %q", response.Code, response.Body.String())
	}
}

func TestUnknownConfigFieldIsRefused(t *testing.T) {
	h := plugintest.Load(t, Definition, "mesage: typo", nil)
	if got := h.Host.Statuses()[0].State; got != "failed" {
		t.Fatalf("state: %s", got)
	}
}
`
