package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func start(name string, fn func(*Context) error) Definition {
	return Definition{Name: name, Start: fn}
}

func noop(*Context) error { return nil }

func hostWith(defs ...Definition) (*Host, []*Entry) {
	registry := NewRegistry()
	var entries []*Entry
	for _, d := range defs {
		registry.Add(d)
		entries = append(entries, &Entry{Name: d.Name})
	}
	return NewHost(registry), entries
}

func statusOf(t *testing.T, h *Host, name string) Status {
	t.Helper()
	for _, s := range h.Statuses() {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("no status for %s in %v", name, h.Statuses())
	return Status{}
}

func serve(h *Host, path string) int {
	handler := h.Match(http.MethodGet, path)
	if handler == nil {
		return http.StatusNotFound
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
	return recorder.Code
}

func ok(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }

func TestRegistryRejectsBadDefinitions(t *testing.T) {
	cases := map[string]Definition{
		"bad name": {Name: "Bad Name", Start: noop},
		"no start": {Name: "fine"},
	}
	for name, def := range cases {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recover() == nil {
					t.Fatal("expected a panic")
				}
			}()
			NewRegistry().Add(def)
		})
	}
	t.Run("duplicate", func(t *testing.T) {
		defer func() {
			if recover() == nil {
				t.Fatal("expected a panic")
			}
		}()
		r := NewRegistry()
		r.Add(start("a", noop))
		r.Add(start("a", noop))
	})
}

func TestDisablingUndoesEverythingNewestFirst(t *testing.T) {
	var undone []string
	h, entries := hostWith(start("a", func(ctx *Context) error {
		ctx.HandleFunc("GET /a", ok)
		ctx.On("topic", func(Event) { undone = append(undone, "event") })
		ctx.Defer(func() error { undone = append(undone, "first"); return nil })
		ctx.Defer(func() error { undone = append(undone, "second"); return nil })
		return nil
	}))
	h.Reconcile(entries)
	if got := serve(h, "/a"); got != http.StatusOK {
		t.Fatalf("route: got %d", got)
	}
	entries[0].Disabled = true
	h.Reconcile(entries)
	if got := serve(h, "/a"); got != http.StatusNotFound {
		t.Fatalf("route should be gone, got %d", got)
	}
	if strings.Join(undone, ",") != "second,first" {
		t.Fatalf("undo order: %v", undone)
	}
	h.bus.publish(Event{Topic: "topic"})
	if len(undone) != 2 {
		t.Fatal("subscription survived disable")
	}
	if got := statusOf(t, h, "a").State; got != StateDisabled {
		t.Fatalf("state: %s", got)
	}
}

func TestAllUndoStepsRunWhenOneFails(t *testing.T) {
	ran := 0
	h, entries := hostWith(start("a", func(ctx *Context) error {
		ctx.Defer(func() error { ran++; return nil })
		ctx.Defer(func() error { ran++; return errors.New("boom") })
		return nil
	}))
	h.Reconcile(entries)
	h.Shutdown()
	if ran != 2 {
		t.Fatalf("ran %d undo steps", ran)
	}
}

func TestFailedStartLeavesNothingBehind(t *testing.T) {
	for name, fail := range map[string]func() error{
		"error": func() error { return errors.New("no") },
		"panic": func() error { panic("no") },
	} {
		t.Run(name, func(t *testing.T) {
			undone := false
			h, entries := hostWith(Definition{
				Name:     "a",
				Provides: []Key{"svc"},
				Start: func(ctx *Context) error {
					ctx.Provide("svc", 1)
					ctx.HandleFunc("GET /a", ok)
					ctx.Defer(func() error { undone = true; return nil })
					return fail()
				},
			})
			h.Reconcile(entries)
			if got := statusOf(t, h, "a"); got.State != StateFailed || got.Reason == "" {
				t.Fatalf("status: %+v", got)
			}
			if serve(h, "/a") != http.StatusNotFound {
				t.Fatal("route from a failed start went live")
			}
			if _, leaked := h.values["svc"]; leaked {
				t.Fatal("service from a failed start was published")
			}
			if !undone {
				t.Fatal("undo did not run")
			}
		})
	}
}

func TestPluginWaitsForNeedThenActivates(t *testing.T) {
	consumer := Definition{Name: "consumer", Needs: []Key{"svc"}, Start: noop}
	provider := Definition{Name: "provider", Provides: []Key{"svc"}, Start: func(ctx *Context) error {
		ctx.Provide("svc", "value")
		return nil
	}}
	h, entries := hostWith(consumer, provider)
	h.Reconcile(entries[:1])
	if got := statusOf(t, h, "consumer"); got.State != StateWaiting || !strings.Contains(got.Reason, "svc") {
		t.Fatalf("status: %+v", got)
	}
	h.Reconcile(entries)
	if got := statusOf(t, h, "consumer").State; got != StateActive {
		t.Fatalf("state: %s", got)
	}
	h.Reconcile(entries[:1])
	if got := statusOf(t, h, "consumer").State; got != StateWaiting {
		t.Fatalf("consumer should wait once its provider leaves, got %s", got)
	}
}

func TestProviderChangeRestartsConsumersFirst(t *testing.T) {
	var log []string
	var seen atomic.Value
	consumer := Definition{Name: "consumer", Needs: []Key{"svc"}, Start: func(ctx *Context) error {
		seen.Store(Get[string](ctx, "svc"))
		log = append(log, "consumer+")
		ctx.Defer(func() error { log = append(log, "consumer-"); return nil })
		return nil
	}}
	provider := Definition{Name: "provider", Provides: []Key{"svc"}, Start: func(ctx *Context) error {
		var cfg struct {
			Value string `yaml:"value"`
		}
		if err := ctx.Decode(&cfg); err != nil {
			return err
		}
		ctx.Provide("svc", cfg.Value)
		log = append(log, "provider+")
		ctx.Defer(func() error { log = append(log, "provider-"); return nil })
		return nil
	}}
	h, entries := hostWith(consumer, provider)
	entries[1].Config = node(t, "value: one")
	h.Reconcile(entries)
	h.Reconcile(entries)
	if len(log) != 2 {
		t.Fatalf("an unchanged reconcile must not restart: %v", log)
	}
	entries[1].Config = node(t, "value: two")
	h.Reconcile(entries)
	want := "provider+,consumer+,consumer-,provider-,provider+,consumer+"
	if got := strings.Join(log, ","); got != want {
		t.Fatalf("got %s", got)
	}
	if seen.Load() != "two" {
		t.Fatalf("consumer saw %v", seen.Load())
	}
}

func TestWantRestartsConsumerWhenItAppears(t *testing.T) {
	var seen []string
	consumer := Definition{Name: "consumer", Wants: []Key{"svc"}, Start: func(ctx *Context) error {
		seen = append(seen, Get[string](ctx, "svc"))
		return nil
	}}
	provider := Definition{Name: "provider", Provides: []Key{"svc"}, Start: func(ctx *Context) error {
		ctx.Provide("svc", "value")
		return nil
	}}
	h, entries := hostWith(consumer, provider)
	h.Reconcile(entries[:1])
	h.Reconcile(entries)
	h.Reconcile(entries[:1])
	if got := strings.Join(seen, ","); got != ",value," {
		t.Fatalf("got %q", got)
	}
}

func TestRetryingProviderDoesNotChurnWantConsumer(t *testing.T) {
	var attempts, consumerStarts atomic.Int32
	consumer := Definition{Name: "consumer", Wants: []Key{"svc"}, Start: func(ctx *Context) error {
		consumerStarts.Add(1)
		return nil
	}}
	provider := Definition{Name: "provider", Provides: []Key{"svc"}, Start: func(ctx *Context) error {
		if attempts.Add(1) < 3 {
			return Retry(errors.New("down"), time.Millisecond)
		}
		ctx.Provide("svc", "value")
		return nil
	}}
	h, entries := hostWith(consumer, provider)
	defer h.Shutdown()
	h.Reconcile(entries)
	deadline := time.Now().Add(5 * time.Second)
	for statusOf(t, h, "provider").State != StateActive {
		if time.Now().After(deadline) {
			t.Fatalf("provider never recovered: %+v", h.Statuses())
		}
		time.Sleep(time.Millisecond)
	}
	if got := consumerStarts.Load(); got != 2 {
		t.Fatalf("consumer should start once and restart once for the new service, started %d times", got)
	}
}

func TestCycleIsReportedAndOthersStillRun(t *testing.T) {
	a := Definition{Name: "a", Needs: []Key{"b"}, Provides: []Key{"a"}, Start: noop}
	b := Definition{Name: "b", Needs: []Key{"a"}, Provides: []Key{"b"}, Start: noop}
	c := start("c", noop)
	h, entries := hostWith(a, b, c)
	h.Reconcile(entries)
	for _, name := range []string{"a", "b"} {
		if got := statusOf(t, h, name); got.State != StateFailed || !strings.Contains(got.Reason, "cycle") {
			t.Fatalf("%s: %+v", name, got)
		}
	}
	if got := statusOf(t, h, "c").State; got != StateActive {
		t.Fatalf("c: %s", got)
	}
}

func TestWantCycleIsAlsoACycle(t *testing.T) {
	a := Definition{Name: "a", Wants: []Key{"b"}, Provides: []Key{"a"}, Start: func(c *Context) error { c.Provide("a", 1); return nil }}
	b := Definition{Name: "b", Needs: []Key{"a"}, Provides: []Key{"b"}, Start: func(c *Context) error { c.Provide("b", 1); return nil }}
	h, entries := hostWith(a, b)
	h.Reconcile(entries)
	if got := statusOf(t, h, "a"); got.State != StateFailed {
		t.Fatalf("a: %+v", got)
	}
}

func TestConfigurationMistakesAreNamed(t *testing.T) {
	h, _ := hostWith(start("a", noop), start("b", noop))
	h.Reconcile([]*Entry{{Name: "a"}, {Name: "a"}, {Name: "ghost"}})
	if got := statusOf(t, h, "a"); got.State != StateFailed || !strings.Contains(got.Reason, "twice") {
		t.Fatalf("duplicate: %+v", got)
	}
	if got := statusOf(t, h, "ghost"); got.State != StateFailed || !strings.Contains(got.Reason, "unknown plugin") {
		t.Fatalf("unknown: %+v", got)
	}
}

func TestDuplicateAndCoreProvidersAreRejected(t *testing.T) {
	a := Definition{Name: "a", Provides: []Key{"svc"}, Start: func(c *Context) error { c.Provide("svc", 1); return nil }}
	b := Definition{Name: "b", Provides: []Key{"svc"}, Start: noop}
	c := Definition{Name: "c", Provides: []Key{CoreConfig}, Start: noop}
	h, entries := hostWith(a, b, c)
	h.SetCore(CoreConfig, "cfg")
	h.Reconcile(entries)
	if got := statusOf(t, h, "b"); got.State != StateFailed || !strings.Contains(got.Reason, "already provided") {
		t.Fatalf("b: %+v", got)
	}
	if got := statusOf(t, h, "c"); got.State != StateFailed || !strings.Contains(got.Reason, "core service") {
		t.Fatalf("c: %+v", got)
	}
}

func TestCapabilitiesAreEnforced(t *testing.T) {
	cases := map[string]Definition{
		"undeclared read":    {Name: "a", Start: func(c *Context) error { Get[string](c, CoreConfig); return nil }},
		"undeclared provide": {Name: "a", Start: func(c *Context) error { c.Provide("svc", 1); return nil }},
		"missing provide":    {Name: "a", Provides: []Key{"svc"}, Start: noop},
		"wrong type":         {Name: "a", Needs: []Key{CoreConfig}, Start: func(c *Context) error { Get[int](c, CoreConfig); return nil }},
	}
	for name, def := range cases {
		t.Run(name, func(t *testing.T) {
			h, entries := hostWith(def)
			h.SetCore(CoreConfig, "cfg")
			h.Reconcile(entries)
			if got := statusOf(t, h, "a").State; got != StateFailed {
				t.Fatalf("state: %s", got)
			}
		})
	}
}

func TestRouteConflictFailsTheSecondPlugin(t *testing.T) {
	route := func(c *Context) error { c.HandleFunc("GET /same", ok); return nil }
	h, entries := hostWith(start("a", route), start("b", route))
	h.Reconcile(entries)
	if got := statusOf(t, h, "b"); got.State != StateFailed || !strings.Contains(got.Reason, "conflict") {
		t.Fatalf("b: %+v", got)
	}
	if serve(h, "/same") != http.StatusOK {
		t.Fatal("the first plugin's route should survive")
	}
}

func TestDecodeRefusesUnknownFields(t *testing.T) {
	h, entries := hostWith(start("a", func(c *Context) error {
		var cfg struct {
			Known string `yaml:"known"`
		}
		return c.Decode(&cfg)
	}))
	entries[0].Config = node(t, "knwon: typo")
	h.Reconcile(entries)
	if got := statusOf(t, h, "a"); got.State != StateFailed || !strings.Contains(got.Reason, "knwon") {
		t.Fatalf("status: %+v", got)
	}
}

func TestJobsStopWithThePlugin(t *testing.T) {
	var stopped atomic.Bool
	h, entries := hostWith(start("a", func(c *Context) error {
		c.Go("wait", func(ctx context.Context) {
			<-ctx.Done()
			stopped.Store(true)
		})
		c.Go("crash", func(context.Context) { panic("job crash stays in the job") })
		return nil
	}))
	h.Reconcile(entries)
	h.Shutdown()
	if !stopped.Load() {
		t.Fatal("job did not stop before Shutdown returned")
	}
}

func TestEveryRunsUntilStopped(t *testing.T) {
	var runs atomic.Int32
	h, entries := hostWith(start("a", func(c *Context) error {
		c.Every("tick", time.Millisecond, func(context.Context) error {
			runs.Add(1)
			return fmt.Errorf("errors are logged and the job keeps going")
		})
		return nil
	}))
	h.Reconcile(entries)
	deadline := time.Now().Add(5 * time.Second)
	for runs.Load() < 2 {
		if time.Now().After(deadline) {
			t.Fatal("job did not repeat")
		}
		time.Sleep(time.Millisecond)
	}
	h.Shutdown()
	after := runs.Load()
	time.Sleep(10 * time.Millisecond)
	if runs.Load() != after {
		t.Fatal("job ran after Shutdown")
	}
}

func TestEventsReachSubscribersAndPanicsStayContained(t *testing.T) {
	var got atomic.Value
	h, entries := hostWith(
		start("a-sub", func(c *Context) error {
			c.On("t", func(e Event) { got.Store(e) })
			c.On("t", func(Event) { panic("contained") })
			return nil
		}),
		start("z-pub", func(c *Context) error { c.Publish("t", 7); return nil }),
	)
	h.Reconcile(entries)
	event, ok := got.Load().(Event)
	if !ok || event.Data != 7 || event.Source != "z-pub" {
		t.Fatalf("event: %+v", got.Load())
	}
}

func TestSetCoreChangeRestartsDependents(t *testing.T) {
	starts := 0
	h, entries := hostWith(Definition{Name: "a", Needs: []Key{CoreConfig}, Start: func(*Context) error { starts++; return nil }})
	one, two := new(int), new(int)
	h.SetCore(CoreConfig, one)
	h.Reconcile(entries)
	h.SetCore(CoreConfig, one)
	h.Reconcile(entries)
	if starts != 1 {
		t.Fatalf("same value restarted: %d", starts)
	}
	h.SetCore(CoreConfig, two)
	h.Reconcile(entries)
	if starts != 2 {
		t.Fatalf("new value did not restart: %d", starts)
	}
}

func TestShutdownThenReconcileDoesNothing(t *testing.T) {
	h, entries := hostWith(start("a", noop))
	h.Shutdown()
	h.Reconcile(entries)
	if len(h.active) != 0 {
		t.Fatal("a closed host started a plugin")
	}
}
