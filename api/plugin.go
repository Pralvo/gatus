package api

import (
	"github.com/TwiN/gatus/v5/plugin"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/adaptor"
)

// pluginRoutes hands a request to a plugin route if one matches. Fiber cannot
// remove a route, so plugins live behind this one stable seam and can come and
// go at runtime. It sits ahead of the security middleware: a plugin route is
// public unless the plugin authenticates the request.
func pluginRoutes(c *fiber.Ctx) error {
	handler := plugin.Default.Match(c.Method(), c.Path())
	if handler == nil {
		return c.Next()
	}
	return adaptor.HTTPHandler(handler)(c)
}
