// Package visitor works out the few facts a problem report keeps about the
// person who sent it: a coarse browser and system, and a country code from a
// trusted proxy. It also limits how often one client may send. Nothing here
// keeps an address, a raw User-Agent or anything that identifies a device.
package visitor

import "strings"

// Agent is what a report keeps from the User-Agent header: a browser family,
// its major version, and a system family. Empty means not recognised.
type Agent struct {
	Browser string
	Major   int
	OS      string
}

// maxAgentBytes bounds the work done on a header the client controls.
const maxAgentBytes = 512

// browsers are checked in order, because most browsers also name the ones they
// are built on: Edge says Chrome and Safari, and Chrome says Safari.
var browsers = []struct {
	family string
	tokens []string
}{
	{"Edge", []string{"Edg/", "EdgA/", "EdgiOS/"}},
	{"Opera", []string{"OPR/", "OPiOS/"}},
	{"Samsung Internet", []string{"SamsungBrowser/"}},
	{"Firefox", []string{"Firefox/", "FxiOS/"}},
	{"Chrome", []string{"CriOS/", "Chrome/"}},
	{"Safari", []string{"Version/"}},
}

// systems are checked in order: iOS says "like Mac OS X", and Android says Linux.
var systems = []struct {
	family string
	tokens []string
}{
	{"Windows", []string{"Windows"}},
	{"iOS", []string{"iPhone", "iPad", "iPod"}},
	{"Android", []string{"Android"}},
	{"ChromeOS", []string{"CrOS"}},
	{"macOS", []string{"Macintosh", "Mac OS X"}},
	{"Linux", []string{"Linux"}},
}

// ParseAgent reads a User-Agent header coarsely. The header is used only here,
// and only the families and one version number leave this function.
func ParseAgent(header string) Agent {
	if len(header) > maxAgentBytes {
		header = header[:maxAgentBytes]
	}
	lower := strings.ToLower(header)
	if strings.Contains(lower, "bot") || strings.Contains(lower, "spider") || strings.Contains(lower, "crawl") {
		return Agent{Browser: "Bot"}
	}
	var agent Agent
	for _, browser := range browsers {
		if browser.family == "Safari" && !strings.Contains(header, "Safari/") {
			continue
		}
		if token, at := find(header, browser.tokens); at >= 0 {
			agent.Browser = browser.family
			agent.Major = major(header[at+len(token):])
			break
		}
	}
	for _, system := range systems {
		if _, at := find(header, system.tokens); at >= 0 {
			agent.OS = system.family
			break
		}
	}
	return agent
}

func find(header string, tokens []string) (string, int) {
	for _, token := range tokens {
		if at := strings.Index(header, token); at >= 0 {
			return token, at
		}
	}
	return "", -1
}

// major reads up to four leading digits. Anything else is zero, meaning unknown.
func major(rest string) int {
	n := 0
	for i := 0; i < len(rest) && i < 4; i++ {
		c := rest[i]
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int(c-'0')
	}
	return n
}
