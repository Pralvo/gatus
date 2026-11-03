package watchdog

import (
	"testing"

	"github.com/TwiN/gatus/v5/alerting"
	"github.com/TwiN/gatus/v5/config/endpoint"
	"github.com/TwiN/gatus/v5/config/maintenance"
)

func TestHandleAlertingSkipsEndpointsInScheduledMaintenance(t *testing.T) {
	defer maintenance.SetScheduleCheck(nil)
	ep := &endpoint.Endpoint{Group: "core", Name: "db"}
	failure := &endpoint.Result{Success: false}

	maintenance.SetScheduleCheck(func(key string) bool { return key == ep.Key() })
	HandleAlerting(ep, failure, &alerting.Config{})
	if ep.NumberOfFailuresInARow != 0 {
		t.Fatal("a failure was counted during scheduled maintenance")
	}

	maintenance.SetScheduleCheck(nil)
	HandleAlerting(ep, failure, &alerting.Config{})
	if ep.NumberOfFailuresInARow != 1 {
		t.Fatal("negative control: failures must be counted outside maintenance")
	}
}
