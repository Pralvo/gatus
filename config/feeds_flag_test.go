package config

import (
	"testing"

	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugin"
)

func TestValidateUIConfigTellsThePageAboutFeeds(t *testing.T) {
	scenarios := []struct {
		name    string
		plugins []*plugin.Entry
		want    bool
	}{
		{name: "no plugins"},
		{name: "feeds", plugins: []*plugin.Entry{{Name: "feeds"}}, want: true},
		{name: "feeds disabled", plugins: []*plugin.Entry{{Name: "feeds", Disabled: true}}},
		{name: "other plugin", plugins: []*plugin.Entry{{Name: "report-pages"}}},
	}
	for _, scenario := range scenarios {
		t.Run(scenario.name, func(t *testing.T) {
			cfg := &Config{UI: &ui.Config{}, Plugins: scenario.plugins}
			if err := ValidateUIConfig(cfg); err != nil {
				t.Fatal(err)
			}
			if cfg.UI.Feeds != scenario.want {
				t.Fatalf("feeds = %v, want %v", cfg.UI.Feeds, scenario.want)
			}
		})
	}
}
