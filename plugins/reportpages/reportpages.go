// Package reportpages serves the published reports of the incidents plugin as
// public HTML pages: a list at /reports and one page per report at
// /reports/{id}. The pages are rendered on the server and need no JavaScript.
//
// The incidents service is wanted rather than needed, so the pages stay up when
// it is missing and answer with a plain 503 page instead of disappearing. The
// status page itself never depends on them.
package reportpages

import (
	"errors"
	"fmt"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
)

// incidentsKey is the service the incidents plugin provides. It is written out
// rather than imported, so that this plugin needs only package record.
const incidentsKey plugin.Key = "incidents"

// Config is the plugin's config: block.
type Config struct {
	// Title heads every page. It defaults to the page title of the status page.
	Title string `yaml:"title"`
	// PageSize is how many reports the list shows on one page.
	PageSize int `yaml:"page-size"`
}

// maxPageSize leaves room for the one extra report read to learn whether a
// further page exists.
const maxPageSize = record.MaxLimit - 1

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "report-pages",
	Description: "Public pages for published reports.",
	Needs:       []plugin.Key{plugin.CoreConfig},
	Wants:       []plugin.Key{incidentsKey},
	Start: func(ctx *plugin.Context) error {
		cfg := Config{PageSize: 20}
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		if cfg.PageSize < 1 || cfg.PageSize > maxPageSize {
			return fmt.Errorf("page-size must be between 1 and %d", maxPageSize)
		}
		gatusConfig := plugin.Get[*config.Config](ctx, plugin.CoreConfig)
		if gatusConfig == nil {
			return errors.New("no Gatus configuration")
		}
		if cfg.Title == "" && gatusConfig.UI != nil {
			cfg.Title = gatusConfig.UI.Title
		}
		if cfg.Title == "" {
			cfg.Title = "Status"
		}
		service := plugin.Get[record.Service](ctx, incidentsKey)
		if service == nil {
			ctx.Logf("the incidents plugin is not running, so report pages answer 503 until it is")
		}
		pages, err := newPages(reader(service), cfg, endpointNames(gatusConfig), ctx.Logf)
		if err != nil {
			return err
		}
		pages.register(ctx.HandleFunc)
		return nil
	},
}

// reader keeps a missing service a nil interface, so the pages can test for it.
func reader(service record.Service) reportReader {
	if service == nil {
		return nil
	}
	return service
}

// endpointNames maps each configured endpoint key to the name the status page
// shows. A report can name an endpoint that has since left the configuration, and
// the pages then show its key.
func endpointNames(cfg *config.Config) map[string]string {
	names := make(map[string]string, len(cfg.Endpoints)+len(cfg.ExternalEndpoints))
	for _, endpoint := range cfg.Endpoints {
		names[endpoint.Key()] = endpoint.DisplayName()
	}
	for _, endpoint := range cfg.ExternalEndpoints {
		names[endpoint.Key()] = endpoint.DisplayName()
	}
	return names
}
