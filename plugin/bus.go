package plugin

import (
	"sync"

	"github.com/TwiN/logr"
)

// Event is a message passed between plugins.
type Event struct {
	Topic  string
	Source string
	Data   any
}

type subscription struct {
	owner   string
	handler func(Event)
}

type bus struct {
	mu     sync.RWMutex
	topics map[string]map[int]subscription
	nextID int
}

func newBus() *bus { return &bus{topics: make(map[string]map[int]subscription)} }

func (b *bus) subscribe(owner, topic string, handler func(Event)) (remove func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.nextID
	b.nextID++
	if b.topics[topic] == nil {
		b.topics[topic] = make(map[int]subscription)
	}
	b.topics[topic][id] = subscription{owner: owner, handler: handler}
	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.topics[topic], id)
	}
}

// publish delivers outside the lock so a handler may subscribe or publish.
func (b *bus) publish(event Event) {
	b.mu.RLock()
	subscribers := make([]subscription, 0, len(b.topics[event.Topic]))
	for _, s := range b.topics[event.Topic] {
		subscribers = append(subscribers, s)
	}
	b.mu.RUnlock()
	for _, s := range subscribers {
		deliver(s, event)
	}
}

func deliver(s subscription, event Event) {
	defer func() {
		if r := recover(); r != nil {
			logr.Errorf("[plugin.%s] handler for %s panicked: %v", s.owner, event.Topic, r)
		}
	}()
	s.handler(event)
}
