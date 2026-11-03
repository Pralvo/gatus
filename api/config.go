// Changed by Pralvo: serves notices added by plugins.

package api

import (
	"encoding/json"
	"fmt"

	"github.com/TwiN/gatus/v5/config"
	"github.com/TwiN/gatus/v5/config/announcement"
	"github.com/TwiN/gatus/v5/plugin/notice"
	"github.com/TwiN/gatus/v5/security"
	"github.com/TwiN/logr"
	"github.com/gofiber/fiber/v2"
)

type ConfigHandler struct {
	securityConfig *security.Config
	config         *config.Config
}

func (handler ConfigHandler) GetConfig(c *fiber.Ctx) error {
	hasOIDC := false
	isAuthenticated := true // Default to true if no security config is set
	if handler.securityConfig != nil {
		hasOIDC = handler.securityConfig.OIDC != nil
		isAuthenticated = handler.securityConfig.IsAuthenticated(c)
	}
	logr.Debugf("[api.GetConfig] /api/v1/config: oidc=%v, authenticated=%v", hasOIDC, isAuthenticated)

	// Prepare response with announcements
	response := map[string]interface{}{
		"oidc":          hasOIDC,
		"authenticated": isAuthenticated,
	}
	// Add announcements if available, otherwise use empty slice
	var configured []*announcement.Announcement
	if handler.config != nil {
		configured = handler.config.Announcements
	}
	if announcements := notice.All(configured); len(announcements) > 0 {
		response["announcements"] = announcements
	} else {
		response["announcements"] = []interface{}{}
	}

	// Return the config as JSON
	c.Set("Content-Type", "application/json")
	responseBytes, err := json.Marshal(response)
	if err != nil {
		return c.Status(500).SendString(fmt.Sprintf(`{"error":"Failed to marshal response: %s"}`, err.Error()))
	}
	return c.Status(200).Send(responseBytes)
}
