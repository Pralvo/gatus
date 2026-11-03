// Package notice merges the notices from configuration with those plugins add,
// so the status page and the feeds read one list.
package notice

import (
	"sort"
	"sync"

	"github.com/TwiN/gatus/v5/config/announcement"
)

// Source returns the notices a plugin wants shown right now.
type Source func() []*announcement.Announcement

var (
	mu      sync.RWMutex
	sources = map[int]Source{}
	nextID  int
)

// AddSource adds a source until the returned function is called. Pass that
// function to Context.Defer so the notices leave with the plugin.
func AddSource(source Source) (remove func() error) {
	mu.Lock()
	defer mu.Unlock()
	id := nextID
	nextID++
	sources[id] = source
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
	merged := append([]*announcement.Announcement{}, configured...)
	mu.RLock()
	for _, source := range sources {
		merged = append(merged, source()...)
	}
	mu.RUnlock()
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].Timestamp.After(merged[j].Timestamp) })
	return merged
}
