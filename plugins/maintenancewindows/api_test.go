package maintenancewindows

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugin/plugintest"
)

func TestPublicListFollowsTheClockAndHidesUnannouncedWindows(t *testing.T) {
	cases := []struct {
		name   string
		moment time.Time
		state  string
	}{
		{name: "before announce", moment: start.Add(-25 * time.Hour)},
		{name: "announced", moment: start.Add(-time.Hour), state: stateUpcoming},
		{name: "at start", moment: start, state: stateInProgress},
		{name: "at end", moment: end, state: stateFinished},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := at(c.moment, window()).public().Windows
			if c.state == "" {
				if len(got) != 0 {
					t.Fatalf("an unannounced window was listed: %+v", got)
				}
				return
			}
			if len(got) != 1 || got[0].State != c.state || got[0].Title != "Upgrade" || got[0].Details != "Reads stay up." {
				t.Fatalf("windows: %+v", got)
			}
		})
	}
}

func TestPublicListIsOrderedByStart(t *testing.T) {
	later := window()
	later.Title, later.Start, later.End = "Later", start.Add(48*time.Hour), end.Add(48*time.Hour)
	got := at(later.Start, later, window()).public().Windows
	if len(got) != 2 || got[0].Title != "Upgrade" || got[1].Title != "Later" {
		t.Fatalf("order: %+v", got)
	}
}

func TestMaintenanceRouteNamesEndpointsAndLeavesSilencingOut(t *testing.T) {
	from := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	until := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	h := plugintest.Start(t, Definition, "windows:\n  - title: Live\n    start: "+from+"\n    end: "+until+"\n    endpoints: [core/db]\n    silence-alerts: false\n", coreConfig())
	response := h.Get("/api/v1/maintenance")
	body := response.Body.String()
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/json" || response.Header().Get("Cache-Control") != "public, max-age=30" {
		t.Fatalf("%d %v %s", response.Code, response.Header(), body)
	}
	if strings.Contains(body, "silence") {
		t.Fatalf("alert settings reached the public list: %s", body)
	}
	var got publicList
	if err := json.Unmarshal(response.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := publicEndpoint{Key: "core_db", Name: "db"}
	if len(got.Windows) != 1 || got.Windows[0].State != stateInProgress || len(got.Windows[0].Endpoints) != 1 || got.Windows[0].Endpoints[0] != want {
		t.Fatalf("windows: %+v", got.Windows)
	}
}

func TestEmptyListIsAnEmptyArray(t *testing.T) {
	h := plugintest.Start(t, Definition, "", coreConfig())
	if body := h.Get("/api/v1/maintenance").Body.String(); body != `{"windows":[]}` {
		t.Fatalf("body: %s", body)
	}
}
