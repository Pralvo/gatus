# Plugins

This fork adds features as plugins, so they stay out of upstream's files. A plugin adds routes, services, event handlers and background jobs through its context, and everything it adds is undone when it stops.

## Use a plugin

List plugins in the configuration. This list is the desired state: the host starts what is listed, stops what is not, and repeats that on every configuration reload.

```yaml
plugins:
  - name: hello
    config:
      message: hi
  - name: another
    disabled: true
```

A plugin that cannot run never stops the status page. It is logged with a state and a reason:

| State | Meaning |
|---|---|
| `active` | Running |
| `waiting` | A service it needs is missing. It starts when the service appears |
| `disabled` | Turned off in the configuration |
| `failed` | Unknown name, bad config, a dependency cycle or a failed start |

## Included plugins

| Plugin | What it does | Needs |
|---|---|---|
| `admin-page` | A page at `/admin` for managing incidents and reports with a token | `incidents` to do anything |
| `database` | A SQL connection for other plugins, separate from Gatus's history store | SQLite file or Postgres server |
| `feeds` | Publishes notices at `/feed/atom.xml`, `/feed/rss.xml` and `/feed/feed.json` | Nothing |
| `incidents` | Internal incidents and public reports, with a token API and notices | `database` |
| `maintenance-windows` | Dated maintenance on the status page and at `/api/v1/maintenance`, with optional alert silencing | Nothing |
| `problem-reports` | A "Report a problem" form at `/report-a-problem`, and a token API to read and delete reports | `database`; a privacy notice and a contact |
| `report-pages` | Public pages for published reports at `/reports` and `/reports/{id}`, and the same as JSON under `/api/v1/reports` | `incidents` to show reports |

```yaml
plugins:
  - name: database
    config:
      type: sqlite                # sqlite or postgres
      path: /data/plugins.db      # the SQLite file
```

```yaml
plugins:
  - name: database
    config:
      type: postgres
      path: ${PLUGIN_DATABASE_DSN} # the connection string, kept out of the file
```

The connection is separate from Gatus's history store, so a database failure switches off the features that need it and leaves the status page up. While the database is down the plugin shows as `failed`, retries every 30 seconds, and the plugins that need it show as `waiting`. An in-memory SQLite path is refused, because its data would vanish on restart. The connection string is never logged.

```yaml
plugins:
  - name: feeds
    config:
      base-url: https://status.example.com # required
      title: Example status                # defaults to the page title
      limit: 50                            # default 50
```

```yaml
plugins:
  - name: maintenance-windows
    config:
      windows:
        - title: Database upgrade
          start: 2026-12-06T02:00:00Z
          end: 2026-12-06T03:00:00Z
          details: Reads stay available.  # shown in the notice
          endpoints: [core/database]      # "group/name" or "name"; empty means all
          silence-alerts: true            # default true
          announce-before: 72h            # default 0
```

A window silences alerts and shows a notice. Checks keep running during the window, so a failure still shows red on the page.

`GET /api/v1/maintenance` lists the same windows as data, oldest start first: `{"windows": [{"title", "start", "end", "state", "details", "endpoints": [{"key", "name"}]}]}`, where `state` is `upcoming`, `in-progress` or `finished` and an empty `endpoints` means every endpoint. A window appears only from its announce time, as its notice does, and alert settings are never listed. The list comes from the configuration and the clock, so it needs no database.

```yaml
plugins:
  - name: database
    config:
      type: postgres
      path: ${PLUGIN_DATABASE_DSN}
  - name: incidents
    config:
      trusted-proxies: 0        # how many proxies sit in front of Gatus
      tokens:
        - name: alice           # recorded as the actor on everything this token does
          sha256: <hex SHA-256 of the token>
```

`incidents` keeps two records, and changing one never changes the other:

- An **incident** is internal: title, severity, commander, state, a timeline that only grows, and a Markdown postmortem.
- A **report** is public: title, stage, affected endpoints with an impact on each, and dated updates. It stays a draft until published.

Published reports appear as notices on the status page. A notice links to `/reports/{id}`, which the `report-pages` plugin serves, and feed entries made from a report link there too. Resolved reports stay in the past notices for 30 days. The page reads a copy of the notices that a job refreshes, so a slow or dead database never holds it up. If reads fail, the last good copy stays up.

#### Tokens

A token is a random secret. The configuration holds only its hash, so it holds nothing that can be used to sign in. Use a generated secret and never a password, because the hash has no salt:

```sh
token=$(openssl rand -hex 32)
printf %s "$token" | sha256sum   # goes in the configuration; printf adds no newline
```

Send the token as `Authorization: Bearer <token>`. Every route below needs it, including reads. After 10 failed attempts from one address in a minute, that address gets `429` until the minute ends. Behind proxies, set `trusted-proxies` to how many there are, so each client is counted by its own address. Left at 0, every client behind a proxy shares one limit.

#### API

Every request and response body is JSON, up to 1 MiB, and unknown fields are refused.

| Route | Body | Does |
|---|---|---|
| `POST /api/v1/admin/incidents` | `title`, `severity`, optional `commander`, `report_id` | Opens an incident |
| `GET /api/v1/admin/incidents` | Query: `state`, `limit`, `offset` | Lists incidents, without timelines |
| `GET /api/v1/admin/incidents/{id}` | | Returns an incident with its timeline |
| `PATCH /api/v1/admin/incidents/{id}` | Any of `title`, `severity`, `commander`, `postmortem`, `report_id` | Edits an incident. An empty `commander` or `report_id` clears it |
| `POST /api/v1/admin/incidents/{id}/state` | `state` | Moves an incident |
| `POST /api/v1/admin/incidents/{id}/notes` | `note` | Adds a note to the timeline |
| `POST /api/v1/admin/reports` | `title`, `stage`, `message`, optional `endpoints`, `published` | Starts a report |
| `GET /api/v1/admin/reports` | Query: `stage`, `published=true`, `limit`, `offset` | Lists reports with their latest update |
| `GET /api/v1/admin/reports/{id}` | | Returns a report with every update |
| `PATCH /api/v1/admin/reports/{id}` | Any of `title`, `endpoints` | Edits a report |
| `POST /api/v1/admin/reports/{id}/updates` | `stage`, `message` | Adds an update, which sets the stage |
| `PUT /api/v1/admin/reports/{id}/publication` | `published` | Publishes a report or returns it to draft |

Values: `severity` is `critical`, `major` or `minor`. `state` is `open`, `mitigated`, `resolved`, `cancelled` or `closed`. `stage` is `investigating`, `identified`, `monitoring` or `resolved`. `endpoints` is a list of `{"key": "core_database", "impact": "major"}`, where `impact` is `degraded`, `partial`, `major` or `maintenance`.

An incident moves between open, mitigated, resolved and cancelled, and can go back to open from any of them. It closes from resolved or cancelled, and a closed incident can no longer change. A key in `endpoints` must exist in the configuration when it is first added, and stays on the report if the endpoint later goes.

Errors look like `{"error": "frozen", "message": "..."}`:

| Status | `error` |
|---|---|
| 400 | `invalid`, `unknown_endpoint` |
| 401 | `unauthorized` |
| 404 | `not_found` |
| 409 | `invalid_transition`, `frozen` |
| 413 | `too_large` |
| 429 | `rate_limited` |
| 503 | `unavailable`: the database failed |

#### Report pages

```yaml
plugins:
  - name: report-pages
    config:
      title: Example status   # heads each page; defaults to the page title
      page-size: 20           # reports per page on the list, 1 to 199; default 20
```

`/reports` lists published reports, unresolved ones first and then the most recently changed, with `?page=2` and onward for older ones. `/reports/{id}` shows one report: its stage, each affected endpoint with its impact, and every update, newest first. Drafts are never shown, and a draft's address looks the same as one that does not exist.

The pages are HTML rendered on the server, and every stored value is escaped. They work with no script, so readers without JavaScript and link previews see the report; the page's title and latest update also go into `og:` tags for previews. When the build has the interface from `web/ui`, each page also loads it, and the interface takes over the page. The policy then allows this site's scripts and styles plus the page's own inline style, and nothing inline beyond that. Times are shown in UTC. They are cached for 30 seconds, so a new update shows within about that long.

The same reports are available as JSON for the page's own scripts. `GET /api/v1/reports` returns `{"reports": [...], "page": 1, "more": false}`, each report with its latest update, and takes the same `?page=`. `GET /api/v1/reports/{id}` returns one report with every update, newest first. A report has `id`, `title`, `stage`, `endpoints` (`key`, `name`, `impact`), `updates` (`stage`, `at`, `message`), `publishedAt`, `resolvedAt` when resolved, and `updatedAt`. It never says who wrote a report or an update. A malformed page number is a `400`, a page past the end is an empty list, and a draft or unknown ID is a `404` with `{"error": "report not found"}`.

The pages want `incidents` rather than needing it, so they stay up without it. If the incidents plugin is not running, or the database fails or takes longer than 3 seconds, they answer `503` with a short page saying reports are unavailable, or `{"error": "reports are unavailable"}` from the JSON routes, which is never cached. The status page, its notices and the feeds keep working.

#### Admin page

```yaml
plugins:
  - name: admin-page   # no settings
```

`/admin` and every address under it, such as `/admin/reports/{id}`, serve the admin entry of the interface in `web/ui`, built into `web/static/admin/index.html`. It lists, creates and edits incidents and reports, posts updates, and publishes, with a preview of the headline visitors will read. If the build has no admin page, the plugin fails by name. It asks for a token from the `incidents` configuration and sends it only as `Authorization: Bearer` to the API above, so everything it can do, the token can do with `curl`. The page itself holds nothing secret and grants nothing.

- The token is kept in the tab's `sessionStorage` and is gone when the tab closes. A refused token signs the page out. No cookies are used.
- The page loads only this site's own scripts and stylesheets, under a policy that allows no inline script or style, no other origin and no framing. Stored text is only ever written into the page as text.
- The route is public like every plugin route, so put it behind your proxy's access rules if you want fewer people to see it.

#### Problem reports

```yaml
plugins:
  - name: problem-reports
    config:
      privacy-url: https://example.com/privacy  # required: https, or a path on this site
      contact: privacy@example.com              # required: an email or https address
      retention: 2160h                          # 24h to 8760h; default 2160h (90 days)
      trusted-proxies: 1                        # proxies in front of Gatus; default 0
      country-header: X-Client-Region           # optional; needs trusted-proxies
      proxy-networks: [10.0.0.0/8]              # optional: where the nearest proxy connects from
      per-client-limit: 5                       # reports per client per hour; default 5
      global-limit: 200                         # reports in all per hour; default 200
      tokens:                                   # who may read and delete; same format as incidents
        - name: alice
          sha256: <hex SHA-256 of the token>
```

The plugin refuses to start without `privacy-url` and `contact`, so the form cannot collect anything until visitors can read what happens to their report. While it runs, the footer and each service page link to `/report-a-problem`, which shows a short notice of what is kept, why and for how long, then the form. Without the plugin there is no link, and the page says reports are not taken. The page sets no cookies and uses no browser storage. What is kept and why is described in [privacy/problem-reports.md](privacy/problem-reports.md).

`POST /api/v1/problem-reports` takes JSON up to 8 KB: `description` (10 to 2000 characters), and optional `service` (an endpoint, suite or group key the page shows), `details` (up to 2000 characters) and `page` (a path on this site; a query or fragment is dropped). It answers `201` with `{"reference": "PR-..."}`. It sends no CORS headers and refuses a request whose `Origin` names another site or whose `Sec-Fetch-Site` is not `same-origin` (`403`). Over the limit it answers `429` with `Retry-After`. The server adds the time to the second, a country code when one can be trusted, and the browser family, its major version and the system family. It never stores the address, the User-Agent, cookies or a device ID. The rate limit counts each client by HMAC-SHA256 of its address under a key made at start and kept only in memory. `GET /api/v1/problem-reports/settings` tells the page the notice address, the contact and the retention in days.

The country is believed only from a proxy: the request must carry at least `trusted-proxies` forwarded hops, and, with `proxy-networks`, come from one of those networks. The header must appear once and hold two capital letters; `XX` and anything else leave the country empty. Make sure the proxy replaces a header of that name that a client sends. Sources that set a request header:

- A Google Cloud external Application Load Balancer, with a custom request header such as `X-Client-Region: {client_region}`. Google describes the value as a CLDR region code, which is usually but not always the ISO code.
- Cloudflare, with visitor location headers on, sends `CF-IPCountry`.

A header that a front end sets on the response, such as `x-country-code`, never reaches Gatus. Do not assume a platform adds a request header until you have seen it arrive on a test service; never test against production.

The token routes are `GET /api/v1/admin/problem-reports` (query `service`, `country`, `from` and `to` as RFC 3339 times, `limit` up to 200, `offset`; returns `{"reports": [...], "more": false}`, newest first), `GET /api/v1/admin/problem-reports/{reference}`, `DELETE /api/v1/admin/problem-reports/{reference}` (`204`), and `GET /api/v1/admin/problem-reports/summary`, which counts the last hour's reports by country and by service. They answer `401` without a valid token, and the admin page shows them under "Problem reports" when its token is also listed here. A purge at start and every hour deletes reports older than `retention`.

#### Build on it

Other plugins import `plugins/incidents/record`, which needs no SQL driver:

```go
var Definition = plugin.Definition{
	Name:  "slack",
	Needs: []plugin.Key{"incidents"},
	Start: func(ctx *plugin.Context) error {
		service := plugin.Get[record.Service](ctx, "incidents")
		ctx.On(record.TopicReportPublished, func(event plugin.Event) {
			report := event.Data.(record.ReportEvent).Report
			// ...
		})
		return nil
	},
}
```

Treat all stored text as untrusted, and render it only through escaping. Drafts raise events and appear in `GetReport`, so anything public must check `Published`. Events are not durable: one is lost if the process stops at the wrong moment.

## Write a plugin

```sh
make plugin NAME=my-plugin
go test ./plugins/myplugin/
```

That creates a working plugin with a test and adds it to `plugins/all/all.go`. Everything else is in `plugin.Definition`:

```go
var Definition = plugin.Definition{
	Name:     "reports",
	Needs:    []plugin.Key{"database"},          // must exist before Start
	Wants:    []plugin.Key{"mailer"},            // used if present
	Provides: []plugin.Key{"reports"},           // Start must publish these
	Start: func(ctx *plugin.Context) error {
		db := plugin.Get[*database.DB](ctx, database.Key)
		ctx.Provide("reports", newStore(db))
		ctx.HandleFunc("GET /reports/{id}", show)
		return nil
	},
}
```

### What the context gives you

| Method | Use |
|---|---|
| `ctx.Decode(&cfg)` | Read the `config:` block. Unknown fields are refused |
| `plugin.Get[T](ctx, key)` | Read a declared service. An undeclared key fails the plugin |
| `ctx.Provide(key, value)` | Publish a declared service |
| `ctx.Handle`, `ctx.HandleFunc` | Add a route with an `http.ServeMux` pattern |
| `ctx.On`, `ctx.Publish` | Exchange events with other plugins |
| `ctx.Go`, `ctx.Every` | Run background jobs that end when the plugin stops |
| `ctx.Defer(undo)` | Record an undo step for anything else |

### Store data

Add `database.Key` to `Needs`, then read the service. `Rebind` lets one SQL string work on both databases, and `Migrate` brings a plugin's tables up to date:

```go
db := plugin.Get[*database.DB](ctx, database.Key)
if err := db.Migrate("reports", []string{
	`CREATE TABLE reports (id TEXT PRIMARY KEY, title TEXT NOT NULL)`, // version 1
	`ALTER TABLE reports ADD COLUMN stage TEXT NOT NULL DEFAULT ''`,   // version 2
}); err != nil {
	return err
}
_, err := db.SQL().ExecContext(ctx.Context(), db.Rebind(`INSERT INTO reports (id, title) VALUES (?, ?)`), id, title)
```

- A migration's version is its place in the list, so only add to the end, and never edit one that has shipped.
- Each migration runs once per owner, in its own transaction. The first failure stops the rest and returns the error.
- A query on a request path or in a job should pass a context with a deadline, so a slow database cannot hold it up.

### Test against Postgres

SQLite tests always run. Tests written with `databasetest.Each` also run on Postgres when `TEST_POSTGRES_DSN` is set, and otherwise report a skip by name. `make dev-db` starts a Postgres container with Podman, for local development only: it binds to the loopback address and has no password.

```sh
make dev-db
export TEST_POSTGRES_DSN='postgres://postgres@127.0.0.1:55432/gatus_dev?sslmode=disable'
go test -race ./plugins/...
```

## Rules

- **Add through the context.** That is what makes a plugin removable. Anything added another way needs `ctx.Defer`.
- **Routes are public.** They sit in front of Gatus's security middleware, because that middleware also guards the public page. A plugin that writes must authenticate each request itself.
- **Returning `plugin.Retry(err, delay)` from `Start`** makes the host try again, for failures that fix themselves, such as a database that is briefly down.
- **Event handlers run on the publisher's goroutine.** Slow work belongs on a job.
- **Dependencies form a graph, not a loop.** A cycle is reported at load. Split the shared part into a third plugin.

## Limits

- Plugins are compiled in. Go's `plugin` package cannot unload code and needs identical toolchains and dependencies, so it is not used.
- Declaring services catches mistakes. It is not a security boundary, because compiled-in code can do anything the process can. Do not compile in code you do not trust.
