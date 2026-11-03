package maintenancewindows

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"
)

// The window states the page shows.
const (
	stateUpcoming   = "upcoming"
	stateInProgress = "in-progress"
	stateFinished   = "finished"
)

type publicEndpoint struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// publicWindow is what the public may see of a window: what the notices already
// say, as data. Alert silencing stays out.
type publicWindow struct {
	Title   string    `json:"title"`
	Start   time.Time `json:"start"`
	End     time.Time `json:"end"`
	State   string    `json:"state"`
	Details string    `json:"details,omitempty"`
	// Endpoints is empty when the window covers every endpoint.
	Endpoints []publicEndpoint `json:"endpoints"`
}

type publicList struct {
	Windows []publicWindow `json:"windows"`
}

// public lists the windows the notices already show, oldest start first. A window
// stays hidden until its announce time, exactly as its notice does.
func (s *schedule) public() publicList {
	now := s.now()
	out := publicList{Windows: make([]publicWindow, 0, len(s.windows))}
	for _, w := range s.windows {
		if now.Before(w.Start.Add(-w.AnnounceBefore)) {
			continue
		}
		state := stateFinished
		switch {
		case now.Before(w.Start):
			state = stateUpcoming
		case now.Before(w.End):
			state = stateInProgress
		}
		endpoints := w.endpoints
		if endpoints == nil {
			endpoints = []publicEndpoint{}
		}
		out.Windows = append(out.Windows, publicWindow{
			Title:     w.Title,
			Start:     w.Start.UTC(),
			End:       w.End.UTC(),
			State:     state,
			Details:   strings.TrimSpace(w.Details),
			Endpoints: endpoints,
		})
	}
	sort.SliceStable(out.Windows, func(i, j int) bool { return out.Windows[i].Start.Before(out.Windows[j].Start) })
	return out
}

// serve answers GET /api/v1/maintenance. The list comes from the configuration
// and the clock, so it never fails and needs no database.
func (s *schedule) serve(w http.ResponseWriter, _ *http.Request) {
	body, err := json.Marshal(s.public())
	if err != nil {
		http.Error(w, `{"error":"this response could not be made"}`, http.StatusInternalServerError)
		return
	}
	header := w.Header()
	header.Set("Content-Type", "application/json")
	header.Set("Cache-Control", "public, max-age=30")
	header.Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(body)
}
