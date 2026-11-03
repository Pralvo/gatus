package plugin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/TwiN/logr"
	"gopkg.in/yaml.v3"
)

// jobStopTimeout bounds how long stopping a plugin waits for its jobs.
const jobStopTimeout = 10 * time.Second

// Context is a plugin's only route to the host. It records every addition so
// that the host can undo them, newest first, when the plugin stops.
type Context struct {
	def    Definition
	host   *Host
	config *yaml.Node
	values map[Key]any

	mu       sync.Mutex
	undo     []func() error
	routes   []route
	provided map[Key]any
	jobs     sync.WaitGroup
	cancel   context.CancelFunc
	lifetime context.Context
}

func newContext(host *Host, def Definition, config *yaml.Node, values map[Key]any) *Context {
	lifetime, cancel := context.WithCancel(context.Background())
	return &Context{
		def:      def,
		host:     host,
		config:   config,
		values:   values,
		provided: make(map[Key]any),
		lifetime: lifetime,
		cancel:   cancel,
	}
}

// Name returns the plugin's name.
func (c *Context) Name() string { return c.def.Name }

// Context returns a context that ends when the plugin stops.
func (c *Context) Context() context.Context { return c.lifetime }

// Logf logs a line prefixed with the plugin's name.
func (c *Context) Logf(format string, args ...any) {
	logr.Infof("[plugin.%s] %s", c.def.Name, fmt.Sprintf(format, args...))
}

// Decode reads the plugin's configuration into out, refusing unknown fields so
// that a misspelt setting fails by name instead of being ignored.
func (c *Context) Decode(out any) error {
	if c.config == nil || c.config.IsZero() {
		return nil
	}
	data, err := yaml.Marshal(c.config)
	if err != nil {
		return err
	}
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true)
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("plugin %s: invalid config: %w", c.def.Name, err)
	}
	return nil
}

// Get returns a declared service. A key the plugin did not declare panics, which
// fails the plugin by name. A Wants key that is absent returns the zero value.
func Get[T any](c *Context, key Key) T {
	var zero T
	if !c.declared(key) {
		panic(fmt.Sprintf("plugin %s read %s without declaring it", c.def.Name, key))
	}
	value, ok := c.values[key]
	if !ok {
		return zero
	}
	typed, ok := value.(T)
	if !ok {
		panic(fmt.Sprintf("plugin %s read %s as %T but it is %T", c.def.Name, key, zero, value))
	}
	return typed
}

func (c *Context) declared(key Key) bool {
	for _, k := range c.def.Needs {
		if k == key {
			return true
		}
	}
	for _, k := range c.def.Wants {
		if k == key {
			return true
		}
	}
	return false
}

// Provide publishes a service. It becomes visible only if Start succeeds.
func (c *Context) Provide(key Key, value any) {
	for _, k := range c.def.Provides {
		if k == key {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.provided[key] = value
			return
		}
	}
	panic(fmt.Sprintf("plugin %s provided %s without declaring it", c.def.Name, key))
}

// Defer records an undo step, for anything added outside the host's own methods.
func (c *Context) Defer(undo func() error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.undo = append(c.undo, undo)
}

// Handle adds a route using http.ServeMux patterns such as "GET /feed/{id}".
// Routes go live only if Start succeeds. Routes are public: a plugin that writes
// must authenticate the request itself.
func (c *Context) Handle(pattern string, handler http.Handler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.routes = append(c.routes, route{pattern: pattern, handler: handler})
}

// HandleFunc is Handle for a function.
func (c *Context) HandleFunc(pattern string, handler http.HandlerFunc) {
	c.Handle(pattern, handler)
}

// On subscribes to a topic until the plugin stops. Handlers run on the
// publisher's goroutine, so slow work belongs on a job.
func (c *Context) On(topic string, handler func(Event)) {
	remove := c.host.bus.subscribe(c.def.Name, topic, handler)
	c.Defer(func() error { remove(); return nil })
}

// Publish sends an event to every subscriber of its topic.
func (c *Context) Publish(topic string, data any) {
	c.host.bus.publish(Event{Topic: topic, Source: c.def.Name, Data: data})
}

// Go runs a background job until its context ends. A panic stops only that job.
func (c *Context) Go(name string, job func(context.Context)) {
	c.jobs.Add(1)
	go func() {
		defer c.jobs.Done()
		defer func() {
			if r := recover(); r != nil {
				logr.Errorf("[plugin.%s] job %s panicked: %v", c.def.Name, name, r)
			}
		}()
		job(c.lifetime)
	}()
}

// Every runs a job on a fixed interval, starting after the first interval.
func (c *Context) Every(name string, interval time.Duration, job func(context.Context) error) {
	c.Go(name, func(ctx context.Context) {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := job(ctx); err != nil {
					logr.Errorf("[plugin.%s] job %s: %s", c.def.Name, name, err.Error())
				}
			}
		}
	})
}

// teardown cancels jobs, waits for them, and runs undo steps newest first. Every
// step runs even if an earlier one fails, and all errors are returned.
func (c *Context) teardown() error {
	c.cancel()
	finished := make(chan struct{})
	go func() { c.jobs.Wait(); close(finished) }()
	var errs []error
	select {
	case <-finished:
	case <-time.After(jobStopTimeout):
		errs = append(errs, fmt.Errorf("plugin %s: jobs still running after %s", c.def.Name, jobStopTimeout))
	}
	c.mu.Lock()
	undo := c.undo
	c.undo = nil
	c.mu.Unlock()
	for i := len(undo) - 1; i >= 0; i-- {
		if err := undo[i](); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
