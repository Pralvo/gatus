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
		db := plugin.Get[*sql.DB](ctx, "database")
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

## Rules

- **Add through the context.** That is what makes a plugin removable. Anything added another way needs `ctx.Defer`.
- **Routes are public.** They sit in front of Gatus's security middleware, because that middleware also guards the public page. A plugin that writes must authenticate each request itself.
- **Returning `plugin.Retry(err, delay)` from `Start`** makes the host try again, for failures that fix themselves, such as a database that is briefly down.
- **Event handlers run on the publisher's goroutine.** Slow work belongs on a job.
- **Dependencies form a graph, not a loop.** A cycle is reported at load. Split the shared part into a third plugin.

## Limits

- Plugins are compiled in. Go's `plugin` package cannot unload code and needs identical toolchains and dependencies, so it is not used.
- Declaring services catches mistakes. It is not a security boundary, because compiled-in code can do anything the process can. Do not compile in code you do not trust.
