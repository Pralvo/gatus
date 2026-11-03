// Changed by Pralvo: checks the files of the React build from web/ui.

package static

import (
	"io/fs"
	"strings"
	"testing"
)

func TestEmbed(t *testing.T) {
	scenarios := []struct {
		path                  string
		shouldExist           bool
		expectedContainString string
	}{
		{
			path:                  "index.html",
			shouldExist:           true,
			expectedContainString: "</body>",
		},
		{
			path:                  "favicon.ico",
			shouldExist:           true,
			expectedContainString: "", // not checking because it's an image
		},
		{
			path:                  "admin/index.html",
			shouldExist:           true,
			expectedContainString: "</body>",
		},
		{
			path:                  "manifest.json",
			shouldExist:           true,
			expectedContainString: "icons",
		},
		{
			path:        "file-that-does-not-exist.html",
			shouldExist: false,
		},
	}
	// The page's own script and stylesheets, whose names change with each build.
	entry := Entry()
	if len(entry.Scripts) == 0 || len(entry.Stylesheets) == 0 {
		t.Fatalf("the built page names no script or stylesheet: %+v", entry)
	}
	for _, asset := range append(entry.Scripts, entry.Stylesheets...) {
		scenarios = append(scenarios, struct {
			path                  string
			shouldExist           bool
			expectedContainString string
		}{path: strings.TrimPrefix(asset, "/"), shouldExist: true})
	}
	staticFileSystem, err := fs.Sub(FileSystem, RootPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range scenarios {
		t.Run(scenario.path, func(t *testing.T) {
			content, err := fs.ReadFile(staticFileSystem, scenario.path)
			if !scenario.shouldExist {
				if err == nil {
					t.Errorf("%s should not have existed", scenario.path)
				}
			} else {
				if err != nil {
					t.Errorf("opening %s should not have returned an error, got %s", scenario.path, err.Error())
				}
				if len(content) == 0 {
					t.Errorf("%s should have existed in the static FileSystem, but was empty", scenario.path)
				}
				if !strings.Contains(string(content), scenario.expectedContainString) {
					t.Errorf("%s should have contained %s, but did not", scenario.path, scenario.expectedContainString)
				}
			}
		})
	}
}
