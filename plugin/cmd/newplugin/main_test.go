package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func scaffoldRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	all := filepath.Join(root, "plugins", "all")
	if err := os.MkdirAll(all, 0o755); err != nil {
		t.Fatal(err)
	}
	seed := "package all\n\nimport (\n\t_ \"" + modulePath + "/plugins/zeta\"\n)\n"
	if err := os.WriteFile(filepath.Join(all, "all.go"), []byte(seed), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestGenerateWritesPluginAndKeepsImportsSorted(t *testing.T) {
	root := scaffoldRoot(t)
	if err := generate(root, "my-plugin"); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"myplugin.go", "myplugin_test.go"} {
		data, err := os.ReadFile(filepath.Join(root, "plugins", "myplugin", file))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "{{") {
			t.Fatalf("%s has an unfilled placeholder", file)
		}
	}
	data, _ := os.ReadFile(filepath.Join(root, "plugins", "all", "all.go"))
	text := string(data)
	if strings.Index(text, "plugins/myplugin") > strings.Index(text, "plugins/zeta") || !strings.Contains(text, "plugins/zeta") {
		t.Fatalf("imports: %s", text)
	}
}

func TestGenerateRefusesBadNameAndExistingPlugin(t *testing.T) {
	root := scaffoldRoot(t)
	if err := generate(root, "Bad Name"); err == nil {
		t.Fatal("expected bad name to be refused")
	}
	if err := generate(root, "dup"); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(root, "plugins", "dup", "dup.go")
	if err := os.WriteFile(marker, []byte("kept"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := generate(root, "dup"); err == nil {
		t.Fatal("expected existing plugin to be refused")
	}
	if data, _ := os.ReadFile(marker); string(data) != "kept" {
		t.Fatal("existing plugin was overwritten")
	}
}
