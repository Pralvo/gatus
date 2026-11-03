package static

import (
	"reflect"
	"testing"
)

func TestEntryOfTakesOnlyItsOwnAssets(t *testing.T) {
	page := []byte(`<head>
<script type="module" crossorigin src="/assets/index-BCjb_aw.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-CKTX.css">
<script type="module" crossorigin src="https://evil.example/x.js"></script>
<link rel="stylesheet" crossorigin href="/assets/../secret.css">
<link rel="stylesheet" href="/css/custom.css">
</head>`)
	got := entryOf(page)
	want := EntryAssets{Scripts: []string{"/assets/index-BCjb_aw.js"}, Stylesheets: []string{"/assets/index-CKTX.css"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestEntryOfAnEmptyPageIsEmpty(t *testing.T) {
	if got := entryOf([]byte("<html></html>")); len(got.Scripts) != 0 || len(got.Stylesheets) != 0 {
		t.Fatalf("got %+v", got)
	}
}
