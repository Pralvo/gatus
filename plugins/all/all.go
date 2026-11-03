// Package all imports every plugin compiled into the gatus binary.
//
// This file is maintained by `make plugin NAME=x`.
package all

import (
	_ "github.com/TwiN/gatus/v5/plugins/database"
	_ "github.com/TwiN/gatus/v5/plugins/feeds"
	_ "github.com/TwiN/gatus/v5/plugins/hello"
	_ "github.com/TwiN/gatus/v5/plugins/incidents"
	_ "github.com/TwiN/gatus/v5/plugins/maintenancewindows"
)
