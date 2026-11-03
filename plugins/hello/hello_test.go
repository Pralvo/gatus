package hello

import (
	"net/http"
	"testing"

	"github.com/TwiN/gatus/v5/plugin/plugintest"
)

func TestRouteUsesConfig(t *testing.T) {
	h := plugintest.Start(t, Definition, "message: configured", nil)
	response := h.Get("/plugins/hello")
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
