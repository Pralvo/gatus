// Package incidents keeps internal incident records and public reports in the
// database, serves a token API for them, and shows published reports as notices.
//
// Other plugins use record.Service and the topics in package record. They need
// only that package, which does not depend on any SQL driver or on this plugin.
package incidents

import (
	"context"
	"time"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/TwiN/gatus/v5/plugin/notice"
	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/incidents/adminapi"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	"github.com/TwiN/gatus/v5/plugins/incidents/sqlstore"
)

// Key is the service this plugin provides. Its value is a record.Service.
const Key plugin.Key = "incidents"

// NoticeSource names this plugin's notices, so a reader that reads the reports
// themselves can leave them out with notice.Except.
const NoticeSource = "incidents"

// retryDelay is how long the host waits after the database failed during Start.
const retryDelay = 30 * time.Second

// Config is the plugin's config: block.
type Config struct {
	// Tokens lists who may use the API.
	Tokens []adminapi.Token `yaml:"tokens"`
	// TrustedProxies is how many proxies sit in front of Gatus. It tells the rate
	// limit where to find the client's address. The default of zero uses the
	// connection's address.
	TrustedProxies int `yaml:"trusted-proxies"`
}

func init() { plugin.Register(Definition) }

// Definition is exported so that tests can run the plugin in their own host.
var Definition = plugin.Definition{
	Name:        "incidents",
	Description: "Internal incidents and public reports, with a token API and notices.",
	Needs:       []plugin.Key{database.Key, plugin.CoreConfig},
	Provides:    []plugin.Key{Key},
	Start: func(ctx *plugin.Context) error {
		var cfg Config
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		if len(cfg.Tokens) == 0 {
			ctx.Logf("no tokens are configured, so the API refuses every request")
		}
		db := plugin.Get[*database.DB](ctx, database.Key)
		store := sqlstore.New(db)
		known := endpointKeys(plugin.Get[*config.Config](ctx, plugin.CoreConfig))
		service := record.NewManager(store, time.Now, ctx.Publish, func(key string) bool { return known[key] })
		api, err := adminapi.New(service, cfg.Tokens, cfg.TrustedProxies, time.Now, ctx.Logf)
		if err != nil {
			return err
		}
		if err := migrate(ctx.Context(), store, db); err != nil {
			return err
		}
		cache := newNoticeCache(service, time.Now, ctx.Logf)
		_ = cache.refresh(ctx.Context()) // a failure is logged, and the job tries again
		ctx.Defer(notice.AddNamedSource(NoticeSource, cache.notices))
		ctx.Go("notice-refresh", cache.run)
		for _, topic := range record.ReportTopics {
			ctx.On(topic, func(plugin.Event) { cache.wake() })
		}
		api.Register(ctx.HandleFunc)
		ctx.Provide(Key, record.Service(service))
		return nil
	},
}

// migrate retries only when the database itself is unreachable. A migration that
// fails on a healthy database will fail the same way next time.
func migrate(ctx context.Context, store *sqlstore.Store, db *database.DB) error {
	err := store.Migrate()
	if err == nil {
		return nil
	}
	checking, cancel := context.WithTimeout(ctx, noticeReadTimeout)
	defer cancel()
	if db.SQL().PingContext(checking) != nil {
		return plugin.Retry(err, retryDelay)
	}
	return err
}

func endpointKeys(cfg *config.Config) map[string]bool {
	known := make(map[string]bool, len(cfg.Endpoints)+len(cfg.ExternalEndpoints))
	for _, endpoint := range cfg.Endpoints {
		known[endpoint.Key()] = true
	}
	for _, endpoint := range cfg.ExternalEndpoints {
		known[endpoint.Key()] = true
	}
	return known
}
