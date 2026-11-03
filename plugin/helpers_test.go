package plugin

import (
	"testing"

	"gopkg.in/yaml.v3"
)

func node(t *testing.T, text string) yaml.Node {
	t.Helper()
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(text), &document); err != nil {
		t.Fatal(err)
	}
	return *document.Content[0]
}
