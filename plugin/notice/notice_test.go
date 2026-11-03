package notice

import (
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/config/announcement"
)

func at(hour int, message string) *announcement.Announcement {
	return &announcement.Announcement{Timestamp: time.Date(2026, 11, 1, hour, 0, 0, 0, time.UTC), Message: message}
}

func TestAllMergesNewestFirstAndSourcesCanLeave(t *testing.T) {
	configured := []*announcement.Announcement{at(1, "configured")}
	remove := AddSource(func() []*announcement.Announcement { return []*announcement.Announcement{at(2, "plugin")} })
	got := All(configured)
	if len(got) != 2 || got[0].Message != "plugin" || got[1].Message != "configured" {
		t.Fatalf("got %+v", got)
	}
	if err := remove(); err != nil {
		t.Fatal(err)
	}
	if got := All(configured); len(got) != 1 {
		t.Fatalf("source survived removal: %+v", got)
	}
	if len(configured) != 1 {
		t.Fatal("All changed the configured list")
	}
}
