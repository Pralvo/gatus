package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
)

func TestPluginRoutes(t *testing.T) {
	plugin.Register(plugin.Definition{
		Name: "api-seam-test",
		Start: func(ctx *plugin.Context) error {
			ctx.HandleFunc("POST /plugin-test/{id}", func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				_, _ = w.Write([]byte(r.PathValue("id") + ":" + string(body)))
			})
			return nil
		},
	})
	entries := []*plugin.Entry{{Name: "api-seam-test"}}
	plugin.Default.Reconcile(entries)
	router := New(&config.Config{UI: ui.GetDefaultConfig()}).Router()

	response, err := router.Test(httptest.NewRequest(http.MethodPost, "/plugin-test/42", strings.NewReader("body")))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || string(body) != "42:body" {
		t.Fatalf("plugin route: %d %q", response.StatusCode, body)
	}

	// A method the plugin did not claim falls through to Gatus rather than being answered by the plugin.
	response, err = router.Test(httptest.NewRequest(http.MethodGet, "/health", nil))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("gatus route behind the seam: %d", response.StatusCode)
	}

	// Disabling the plugin removes the route from the running router.
	entries[0].Disabled = true
	plugin.Default.Reconcile(entries)
	response, err = router.Test(httptest.NewRequest(http.MethodPost, "/plugin-test/42", strings.NewReader("body")))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode == http.StatusOK {
		t.Fatal("route survived disabling the plugin")
	}
}
