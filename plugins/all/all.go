// Package all imports every plugin compiled into the gatus binary.
//
// This file is maintained by `make plugin NAME=x`.
package all

import (
	_ "github.com/TwiN/gatus/v5/plugins/hello"
)
