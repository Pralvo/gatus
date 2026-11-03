// Package adminpage serves the admin app at /admin and every page under it, for
// managing incidents and reports. The app is the "admin" entry of web/ui, built
// into web/static/admin/index.html. It asks for an API token, keeps it in the
// tab's sessionStorage, and calls the token API of the incidents plugin from the
// browser. It sets no cookies and loads nothing from another origin.
//
// The page holds no secret and grants nothing by itself. Every action goes
// through the API, which checks the token on each request.
package adminpage

import (
	"errors"
	"net/http"

	"github.com/TwiN/gatus/v5/plugin"
	static "github.com/TwiN/gatus/v5/web"
)

// pagePath is where the built admin entry lives in the embedded files.
const pagePath = static.RootPath + "/admin/index.html"

// policy lets the page run only this site's scripts and styles, talk only to its
// own origin, and never be framed. No inline script or style can run.
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; " +
	"font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// readPage is a variable so tests can serve a page of their own.
var readPage = func() ([]byte, error) { return static.FileSystem.ReadFile(pagePath) }

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "admin-page",
	Description: "An app for managing incidents and reports with an API token.",
	Start: func(ctx *plugin.Context) error {
		var cfg struct{} // no settings; a misspelt one fails by name
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		page, err := readPage()
		if err != nil {
			return errors.New("the admin page is missing from this build: run make frontend-build")
		}
		handler := serve(page)
		ctx.Handle("GET /admin", handler)
		ctx.Handle("GET /admin/{path...}", handler)
		return nil
	},
}

// serve answers every admin address with the same page; the app reads the path.
func serve(body []byte) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		header := w.Header()
		header.Set("Content-Type", "text/html; charset=utf-8")
		header.Set("Content-Security-Policy", policy)
		header.Set("Cache-Control", "no-store")
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("X-Frame-Options", "DENY")
		header.Set("Referrer-Policy", "no-referrer")
		header.Set("Cross-Origin-Opener-Policy", "same-origin")
		_, _ = w.Write(body)
	})
}
