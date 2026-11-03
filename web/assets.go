package static

import (
	"regexp"
	"sync"
)

// EntryAssets are the script and stylesheets the built page loads. Pages made
// on the server, such as report pages, include them so the same app takes over
// when scripts can run.
type EntryAssets struct {
	Scripts     []string
	Stylesheets []string
}

var (
	moduleScript = regexp.MustCompile(`<script type="module" crossorigin src="(/assets/[A-Za-z0-9._-]+\.js)"`)
	stylesheet   = regexp.MustCompile(`<link rel="stylesheet" crossorigin href="(/assets/[A-Za-z0-9._-]+\.css)"`)

	entryOnce   sync.Once
	entryAssets EntryAssets
)

// Entry returns the built page's own assets, read once from the embedded page.
// Only same-site /assets/ paths are taken, so nothing else can be injected.
func Entry() EntryAssets {
	entryOnce.Do(func() {
		page, err := FileSystem.ReadFile(IndexPath)
		if err != nil {
			return
		}
		entryAssets = entryOf(page)
	})
	return entryAssets
}

func entryOf(page []byte) EntryAssets {
	var out EntryAssets
	for _, match := range moduleScript.FindAllSubmatch(page, -1) {
		out.Scripts = append(out.Scripts, string(match[1]))
	}
	for _, match := range stylesheet.FindAllSubmatch(page, -1) {
		out.Stylesheets = append(out.Stylesheets, string(match[1]))
	}
	return out
}
