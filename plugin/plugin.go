// Package plugin is the extension kernel for this fork of Gatus.
//
// Features that are not part of upstream Gatus are written as plugins so that
// they stay out of upstream's files. A plugin is a Go package that registers a
// Definition from init. Plugins are compiled in: the standard library's plugin
// package cannot unload code and requires matching toolchains and dependencies,
// so loading is decided by configuration rather than by the dynamic linker.
//
// Two rules shape the kernel:
//
//   - Everything a plugin adds goes through its Context, which records how to
//     undo it. Disabling a plugin therefore needs no uninstall code.
//   - A plugin declares the services it needs. It stays inactive, with a named
//     reason, until they exist, and it is restarted when they change.
//
// Declaring needs catches mistakes between plugins. It is not a security
// boundary: compiled-in code can do anything the process can.
package plugin

import (
	"fmt"
	"regexp"
	"sort"
	"sync"

	"gopkg.in/yaml.v3"
)

// Key names a service that one plugin provides and others consume.
type Key string

// Core services are set by the host program rather than by a plugin.
const (
	// CoreConfig is the running *config.Config.
	CoreConfig Key = "gatus.config"
)

// Definition describes a plugin. It is plain data, so plugins can also be built
// programmatically, for example from a table in a test.
type Definition struct {
	// Name is the identifier used under plugins: in the configuration.
	Name string
	// Description is one line for humans.
	Description string
	// Needs lists services that must exist before Start runs.
	Needs []Key
	// Wants lists services that are used if present. The plugin is restarted
	// when one appears or disappears.
	Wants []Key
	// Provides lists the services Start must publish with Context.Provide.
	Provides []Key
	// Start activates the plugin. Everything it adds must go through ctx.
	Start func(ctx *Context) error
}

func (d Definition) validate() error {
	if !namePattern.MatchString(d.Name) {
		return fmt.Errorf("plugin name %q must match %s", d.Name, namePattern)
	}
	if d.Start == nil {
		return fmt.Errorf("plugin %s has no Start function", d.Name)
	}
	return nil
}

var namePattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// Entry is one item under plugins: in the configuration.
type Entry struct {
	// Name selects a registered plugin.
	Name string `yaml:"name"`
	// Disabled keeps the entry in the file without running it.
	Disabled bool `yaml:"disabled,omitempty"`
	// Config is decoded by the plugin with Context.Decode.
	Config yaml.Node `yaml:"config,omitempty"`
}

// Registry holds the plugins compiled into a program.
type Registry struct {
	mu          sync.RWMutex
	definitions map[string]Definition
}

// NewRegistry returns an empty Registry.
func NewRegistry() *Registry {
	return &Registry{definitions: make(map[string]Definition)}
}

// Add registers a definition. A bad definition is a programming error, so it panics.
func (r *Registry) Add(d Definition) {
	if err := d.validate(); err != nil {
		panic(err)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.definitions[d.Name]; exists {
		panic(fmt.Sprintf("plugin %s is registered twice", d.Name))
	}
	r.definitions[d.Name] = d
}

func (r *Registry) get(name string) (Definition, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.definitions[name]
	return d, ok
}

// Names returns the registered plugin names in sorted order.
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	names := make([]string, 0, len(r.definitions))
	for name := range r.definitions {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// DefaultRegistry and Default are what the gatus binary uses.
var (
	DefaultRegistry = NewRegistry()
	Default         = NewHost(DefaultRegistry)
)

// Register adds a definition to DefaultRegistry. Call it from init.
func Register(d Definition) { DefaultRegistry.Add(d) }
