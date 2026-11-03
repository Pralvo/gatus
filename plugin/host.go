package plugin

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/TwiN/logr"
	"gopkg.in/yaml.v3"
)

// State says what a configured plugin is doing.
type State string

const (
	StateActive   State = "active"
	StateWaiting  State = "waiting"
	StateDisabled State = "disabled"
	StateFailed   State = "failed"
)

// Status reports one configured plugin. Reason is set unless it is active.
type Status struct {
	Name   string `json:"name"`
	State  State  `json:"state"`
	Reason string `json:"reason,omitempty"`
}

// RetryError asks the host to try a failed Start again later, for failures that
// fix themselves, such as a database that is briefly down.
type RetryError struct {
	Err   error
	After time.Duration
}

func (e *RetryError) Error() string { return e.Err.Error() }
func (e *RetryError) Unwrap() error { return e.Err }

// Retry wraps err so that the host tries Start again after the delay.
func Retry(err error, after time.Duration) error { return &RetryError{Err: err, After: after} }

type route struct {
	pattern string
	handler http.Handler
}

type running struct {
	ctx         *Context
	fingerprint string
	wanted      map[Key]bool // which Wants were present at start
}

// Host runs plugins. The configured list is the desired state, and Reconcile
// brings the running set in line with it.
type Host struct {
	registry *Registry
	bus      *bus
	mux      atomic.Pointer[http.ServeMux]

	mu      sync.Mutex
	entries []*Entry
	core    map[Key]any
	coreGen map[Key]int
	values  map[Key]any
	active  map[string]*running
	order   []string // start order of active plugins
	status  map[string]Status
	retry   *time.Timer
	closed  bool
}

// NewHost returns a Host that starts plugins from registry.
func NewHost(registry *Registry) *Host {
	h := &Host{
		registry: registry,
		bus:      newBus(),
		core:     make(map[Key]any),
		coreGen:  make(map[Key]int),
		values:   make(map[Key]any),
		active:   make(map[string]*running),
		status:   make(map[string]Status),
	}
	h.mux.Store(http.NewServeMux())
	return h
}

// SetCore publishes a service owned by the host program. The value must be
// comparable, such as a pointer. Plugins that depend on it restart at the next
// Reconcile if the value changed.
func (h *Host) SetCore(key Key, value any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if old, ok := h.core[key]; !ok || old != value {
		h.coreGen[key]++
	}
	h.core[key] = value
	h.values[key] = value
}

// Match returns a handler if a plugin route matches, or nil otherwise.
func (h *Host) Match(method, path string) http.Handler {
	mux := h.mux.Load()
	_, pattern := mux.Handler(&http.Request{Method: method, URL: &url.URL{Path: path}})
	if pattern == "" {
		return nil
	}
	return mux
}

// Statuses reports every configured plugin, sorted by name.
func (h *Host) Statuses() []Status {
	h.mu.Lock()
	defer h.mu.Unlock()
	statuses := make([]Status, 0, len(h.status))
	for _, s := range h.status {
		statuses = append(statuses, s)
	}
	sort.Slice(statuses, func(i, j int) bool { return statuses[i].Name < statuses[j].Name })
	return statuses
}

// Reconcile makes the running plugins match entries. It never returns an error:
// a plugin that cannot run is reported in Statuses and logged, so a plugin can
// never take the status page down.
func (h *Host) Reconcile(entries []*Entry) []Status {
	h.mu.Lock()
	h.entries = entries
	h.reconcileLocked()
	h.mu.Unlock()
	statuses := h.Statuses()
	for _, s := range statuses {
		switch s.State {
		case StateActive:
			logr.Infof("[plugin] %s is active", s.Name)
		case StateDisabled:
			logr.Infof("[plugin] %s is disabled", s.Name)
		case StateWaiting:
			logr.Warnf("[plugin] %s is waiting: %s", s.Name, s.Reason)
		default:
			logr.Errorf("[plugin] %s failed: %s", s.Name, s.Reason)
		}
	}
	return statuses
}

// Shutdown stops every plugin, newest first.
func (h *Host) Shutdown() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	if h.retry != nil {
		h.retry.Stop()
	}
	for i := len(h.order) - 1; i >= 0; i-- {
		h.stopLocked(h.order[i])
	}
	h.rebuildRoutesLocked()
}

type plan struct {
	defs     map[string]Definition
	configs  map[string]*yaml.Node
	sorted   []string
	provider map[Key]string
}

func (h *Host) reconcileLocked() {
	if h.closed {
		return
	}
	if h.retry != nil {
		h.retry.Stop()
		h.retry = nil
	}
	h.status = make(map[string]Status)
	p := h.planLocked()
	// Stop anything that left the plan or whose inputs changed, dependents
	// first, so that a service never disappears under a running consumer.
	prints := h.fingerprintsLocked(p)
	restart := make(map[string]bool)
	for _, name := range p.sorted {
		current, isRunning := h.active[name]
		if !isRunning {
			continue
		}
		if current.fingerprint != prints[name] || h.dependsOnRestartLocked(p, name, restart) {
			restart[name] = true
		}
	}
	for i := len(h.order) - 1; i >= 0; i-- {
		name := h.order[i]
		if _, planned := p.defs[name]; !planned || restart[name] {
			h.stopLocked(name)
		}
	}
	// Start in dependency order, so one pass reaches a fixed point.
	var retryAfter time.Duration
	for _, name := range p.sorted {
		if _, isRunning := h.active[name]; isRunning {
			if !h.wantsChangedLocked(name) {
				h.status[name] = Status{Name: name, State: StateActive}
				continue
			}
			h.stopWithDependentsLocked(p, name)
		}
		if missing := h.missingLocked(p.defs[name]); missing != "" {
			reason := fmt.Sprintf("needs %s", missing)
			if provider, ok := p.provider[Key(missing)]; ok {
				reason += ", provided by " + provider
			}
			h.status[name] = Status{Name: name, State: StateWaiting, Reason: reason}
			continue
		}
		if err := h.startLocked(name, p, prints[name]); err != nil {
			h.status[name] = Status{Name: name, State: StateFailed, Reason: err.Error()}
			var retry *RetryError
			if errors.As(err, &retry) && (retryAfter == 0 || retry.After < retryAfter) {
				retryAfter = retry.After
			}
			continue
		}
		h.status[name] = Status{Name: name, State: StateActive}
	}
	h.rebuildRoutesLocked()
	if retryAfter > 0 {
		h.retry = time.AfterFunc(retryAfter, func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			logr.Infof("[plugin] retrying plugins that failed to start")
			h.reconcileLocked()
		})
	}
}

// planLocked validates the entries and sorts them so providers come first.
func (h *Host) planLocked() plan {
	p := plan{defs: map[string]Definition{}, configs: map[string]*yaml.Node{}, provider: map[Key]string{}}
	seen := map[string]bool{}
	for _, entry := range h.entries {
		if entry == nil {
			continue
		}
		if seen[entry.Name] {
			h.status[entry.Name] = Status{Name: entry.Name, State: StateFailed, Reason: "configured twice"}
			delete(p.defs, entry.Name)
			continue
		}
		seen[entry.Name] = true
		def, ok := h.registry.get(entry.Name)
		switch {
		case !ok:
			reason := "unknown plugin, available: " + strings.Join(h.registry.Names(), ", ")
			h.status[entry.Name] = Status{Name: entry.Name, State: StateFailed, Reason: reason}
		case entry.Disabled:
			h.status[entry.Name] = Status{Name: entry.Name, State: StateDisabled, Reason: "disabled in configuration"}
		default:
			p.defs[entry.Name] = def
			p.configs[entry.Name] = &entry.Config
		}
	}
	for _, name := range sortedKeys(p.defs) {
		for _, key := range p.defs[name].Provides {
			if _, isCore := h.core[key]; isCore {
				h.excludeLocked(&p, name, fmt.Sprintf("%s is a core service", key))
			} else if other, taken := p.provider[key]; taken {
				h.excludeLocked(&p, name, fmt.Sprintf("%s is already provided by %s", key, other))
			} else {
				p.provider[key] = name
			}
		}
	}
	h.sortPlanLocked(&p)
	return p
}

func (h *Host) excludeLocked(p *plan, name, reason string) {
	h.status[name] = Status{Name: name, State: StateFailed, Reason: reason}
	delete(p.defs, name)
}

// sortPlanLocked orders the plan depth first. A cycle can never be satisfied, so
// it is reported here, from the declarations alone.
func (h *Host) sortPlanLocked(p *plan) {
	const (
		visiting = 1
		done     = 2
	)
	marks := map[string]int{}
	cycles := map[string]string{}
	var path []string
	var visit func(name string)
	visit = func(name string) {
		marks[name] = visiting
		path = append(path, name)
		def := p.defs[name]
		for _, key := range append(append([]Key{}, def.Needs...), def.Wants...) {
			provider, ok := p.provider[key]
			if !ok {
				continue
			}
			if _, planned := p.defs[provider]; !planned {
				continue
			}
			switch marks[provider] {
			case 0:
				visit(provider)
			case visiting:
				for i, n := range path {
					if n == provider {
						loop := strings.Join(append(append([]string{}, path[i:]...), provider), " -> ")
						for _, member := range path[i:] {
							cycles[member] = "dependency cycle: " + loop
						}
					}
				}
			}
		}
		path = path[:len(path)-1]
		marks[name] = done
		p.sorted = append(p.sorted, name)
	}
	for _, name := range sortedKeys(p.defs) {
		if marks[name] == 0 {
			visit(name)
		}
	}
	kept := p.sorted[:0]
	for _, name := range p.sorted {
		if reason, inCycle := cycles[name]; inCycle {
			h.excludeLocked(p, name, reason)
		} else {
			kept = append(kept, name)
		}
	}
	p.sorted = kept
}

// fingerprintsLocked hashes what a plugin's activation depends on, so that an
// unchanged plugin keeps running across a reload.
func (h *Host) fingerprintsLocked(p plan) map[string]string {
	prints := make(map[string]string, len(p.sorted))
	for _, name := range p.sorted {
		hash := sha256.New()
		if node := p.configs[name]; node != nil && !node.IsZero() {
			if data, err := yaml.Marshal(node); err == nil {
				hash.Write(data)
			}
		}
		def := p.defs[name]
		for _, key := range append(append([]Key{}, def.Needs...), def.Wants...) {
			fmt.Fprintf(hash, "|%s=%d", key, h.coreGen[key])
			if _, ok := p.provider[key]; ok {
				fmt.Fprint(hash, "+plugin")
			}
		}
		prints[name] = fmt.Sprintf("%x", hash.Sum(nil))
	}
	return prints
}

// dependsOnRestartLocked reports whether a provider is restarting or not running,
// which means the consumer holds a service that is about to change.
func (h *Host) dependsOnRestartLocked(p plan, name string, restart map[string]bool) bool {
	def := p.defs[name]
	for _, key := range append(append([]Key{}, def.Needs...), def.Wants...) {
		provider, ok := p.provider[key]
		if !ok {
			if _, isCore := h.core[key]; !isCore {
				if _, has := h.values[key]; has {
					return true // the provider left the plan
				}
			}
			continue
		}
		if restart[provider] {
			return true
		}
	}
	return false
}

// wantsChangedLocked reports whether an optional service came or went since name
// started. Providers sort first, so their outcome for this pass is already known.
func (h *Host) wantsChangedLocked(name string) bool {
	current := h.active[name]
	for _, key := range current.ctx.def.Wants {
		if _, present := h.values[key]; present != current.wanted[key] {
			return true
		}
	}
	return false
}

// stopWithDependentsLocked stops name and every running plugin that relies on it,
// consumers first, so that they all start again from fresh services.
func (h *Host) stopWithDependentsLocked(p plan, name string) {
	closure := map[string]bool{name: true}
	for _, candidate := range p.sorted {
		if _, isRunning := h.active[candidate]; isRunning && h.dependsOnRestartLocked(p, candidate, closure) {
			closure[candidate] = true
		}
	}
	for i := len(h.order) - 1; i >= 0; i-- {
		if name := h.order[i]; closure[name] {
			h.stopLocked(name)
		}
	}
}

func (h *Host) missingLocked(def Definition) string {
	for _, key := range def.Needs {
		if _, ok := h.values[key]; !ok {
			return string(key)
		}
	}
	return ""
}

func (h *Host) startLocked(name string, p plan, fingerprint string) (err error) {
	def := p.defs[name]
	values := make(map[Key]any, len(def.Needs)+len(def.Wants))
	for _, key := range append(append([]Key{}, def.Needs...), def.Wants...) {
		if value, ok := h.values[key]; ok {
			values[key] = value
		}
	}
	ctx := newContext(h, def, p.configs[name], values)
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic during start: %v", r)
		}
		if err != nil {
			if undoErr := ctx.teardown(); undoErr != nil {
				logr.Errorf("[plugin.%s] undo after failed start: %s", name, undoErr.Error())
			}
		}
	}()
	if err := def.Start(ctx); err != nil {
		return err
	}
	for _, key := range def.Provides {
		if _, ok := ctx.provided[key]; !ok {
			return fmt.Errorf("started without providing %s", key)
		}
	}
	if err := h.checkRoutesLocked(ctx); err != nil {
		return err
	}
	for key, value := range ctx.provided {
		h.values[key] = value
	}
	wanted := make(map[Key]bool, len(def.Wants))
	for _, key := range def.Wants {
		_, wanted[key] = h.values[key]
	}
	h.active[name] = &running{ctx: ctx, fingerprint: fingerprint, wanted: wanted}
	h.order = append(h.order, name)
	return nil
}

func (h *Host) stopLocked(name string) {
	current, ok := h.active[name]
	if !ok {
		return
	}
	for key := range current.ctx.provided {
		delete(h.values, key)
	}
	delete(h.active, name)
	for i, n := range h.order {
		if n == name {
			h.order = append(h.order[:i], h.order[i+1:]...)
			break
		}
	}
	if err := current.ctx.teardown(); err != nil {
		logr.Errorf("[plugin.%s] stop: %s", name, err.Error())
	}
}

// checkRoutesLocked proves a plugin's routes fit before they go live, because
// ServeMux panics on a conflict.
func (h *Host) checkRoutesLocked(ctx *Context) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("route conflict: %v", r)
		}
	}()
	mux := http.NewServeMux()
	for _, name := range h.order {
		for _, r := range h.active[name].ctx.routes {
			mux.Handle(r.pattern, r.handler)
		}
	}
	for _, r := range ctx.routes {
		mux.Handle(r.pattern, r.handler)
	}
	return nil
}

func (h *Host) rebuildRoutesLocked() {
	mux := http.NewServeMux()
	for _, name := range h.order {
		for _, r := range h.active[name].ctx.routes {
			mux.Handle(r.pattern, r.handler)
		}
	}
	h.mux.Store(mux)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
