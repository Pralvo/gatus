// Package hello is a plugin. Describe what it does here.
package hello

import (
	"net/http"

	"github.com/TwiN/gatus/v5/plugin"
)

// Config is read from the plugin's config: block. Unknown fields are refused.
type Config struct {
	Message string `yaml:"message"`
}

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "hello",
	Description: "Describe this plugin in one line.",
	Start: func(ctx *plugin.Context) error {
		cfg := Config{Message: "hello from hello"}
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		ctx.HandleFunc("GET /plugins/hello", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(cfg.Message))
		})
		return nil
	},
}
