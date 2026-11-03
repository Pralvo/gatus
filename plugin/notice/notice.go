// Package notice merges the notices from configuration with those plugins add,
// so the status page and the feeds read one list.
package notice

import (
	"slices"
	"sort"
	"sync"

	"github.com/TwiN/gatus/v5/config/announcement"
)

// Source returns the notices a plugin wants shown right now.
type Source func() []*announcement.Announcement

// named is a source and the name it was added under, which may be empty.
type named struct {
	name   string
	source Source
}

var (
	mu      sync.RWMutex
	sources = map[int]named{}
	nextID  int
)

// AddSource adds a source until the returned function is called. Pass that
// function to Context.Defer so the notices leave with the plugin.
func AddSource(source Source) (remove func() error) { return AddNamedSource("", source) }

// AddNamedSource is AddSource with a name, so a reader that has the records
// behind these notices can leave the notices out with Except.
func AddNamedSource(name string, source Source) (remove func() error) {
	mu.Lock()
	defer mu.Unlock()
	id := nextID
	nextID++
	sources[id] = named{name: name, source: source}
	return func() error {
		mu.Lock()
		defer mu.Unlock()
		delete(sources, id)
		return nil
	}
}

// All returns configured notices plus plugin notices, newest first. The
// configured notices come first among equal times. They work with no plugin and
// no database, which matters most during an outage.
func All(configured []*announcement.Announcement) []*announcement.Announcement {
	return Except(configured)
}

// Except is All without the sources added under the given names.
func Except(configured []*announcement.Announcement, names ...string) []*announcement.Announcement {
	merged := append([]*announcement.Announcement{}, configured...)
	mu.RLock()
	for _, source := range sources {
		if !slices.Contains(names, source.name) {
			merged = append(merged, source.source()...)
		}
	}
	mu.RUnlock()
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].Timestamp.After(merged[j].Timestamp) })
	return merged
}
