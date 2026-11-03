// Package adminpage serves a small page at /admin for managing incidents and
// reports. The page is static: it asks for an API token, keeps it in the tab's
// sessionStorage, and calls the token API of the incidents plugin from the
// browser. It sets no cookies and loads nothing from another origin.
//
// The page holds no secret and grants nothing by itself. Every action goes
// through the API, which checks the token on each request.
package adminpage

import (
	"embed"
	"net/http"

	"github.com/TwiN/gatus/v5/plugin"
)

//go:embed assets
var assets embed.FS

// policy lets the page run only its own script and style, talk only to its own
// origin, and never be framed. No inline script or style can run.
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; " +
	"base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// file is one asset and how it is served.
type file struct {
	path        string
	contentType string
}

var routes = map[string]file{
	"GET /admin":           {"assets/admin.html", "text/html; charset=utf-8"},
	"GET /admin/admin.js":  {"assets/admin.js", "text/javascript; charset=utf-8"},
	"GET /admin/admin.css": {"assets/admin.css", "text/css; charset=utf-8"},
}

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "admin-page",
	Description: "A page for managing incidents and reports with an API token.",
	Start: func(ctx *plugin.Context) error {
		var cfg struct{} // no settings; a misspelt one fails by name
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		for pattern, f := range routes {
			body, err := assets.ReadFile(f.path)
			if err != nil {
				return err
			}
			ctx.Handle(pattern, serve(body, f.contentType))
		}
		return nil
	},
}

func serve(body []byte, contentType string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		header := w.Header()
		header.Set("Content-Type", contentType)
		header.Set("Content-Security-Policy", policy)
		header.Set("Cache-Control", "no-store")
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("X-Frame-Options", "DENY")
		header.Set("Referrer-Policy", "no-referrer")
		header.Set("Cross-Origin-Opener-Policy", "same-origin")
		header.Set("Cross-Origin-Resource-Policy", "same-origin")
		_, _ = w.Write(body)
	})
}
