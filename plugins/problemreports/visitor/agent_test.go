package visitor

import (
	"strings"
	"testing"
)

func TestParseAgent(t *testing.T) {
	cases := []struct {
		name, header string
		want         Agent
	}{
		{"chrome on windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", Agent{"Chrome", 141, "Windows"}},
		{"edge says chrome too", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57", Agent{"Edge", 141, "Windows"}},
		{"safari on mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15", Agent{"Safari", 26, "macOS"}},
		{"safari on iphone says mac os x", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", Agent{"Safari", 18, "iOS"}},
		{"chrome on ios", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1", Agent{"Chrome", 141, "iOS"}},
		{"firefox on linux", "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0", Agent{"Firefox", 143, "Linux"}},
		{"samsung on android says linux", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36", Agent{"Samsung Internet", 28, "Android"}},
		{"opera", "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0", Agent{"Opera", 124, "ChromeOS"}},
		{"a crawler", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", Agent{Browser: "Bot"}},
		{"curl is not recognised", "curl/8.7.1", Agent{}},
		{"empty", "", Agent{}},
		{"a huge version stops at four digits", "Firefox/1234567", Agent{"Firefox", 1234, ""}},
		{"no version", "Firefox/x", Agent{"Firefox", 0, ""}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ParseAgent(c.header); got != c.want {
				t.Errorf("ParseAgent = %+v, want %+v", got, c.want)
			}
		})
	}
}

// A long header is cut before it is read, so a token past the cut is not seen.
func TestParseAgentReadsOnlyTheStart(t *testing.T) {
	header := strings.Repeat("a", maxAgentBytes) + " Firefox/143.0 (Windows)"
	if got := ParseAgent(header); got != (Agent{}) {
		t.Errorf("ParseAgent read past the limit: %+v", got)
	}
}
