package reportpages

import (
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"html/template"
	"io"
	"strings"
	"time"

	"github.com/TwiN/gatus/v5/config/ui"
	"github.com/TwiN/gatus/v5/plugins/incidents/record"
	static "github.com/TwiN/gatus/v5/web"
)

//go:embed templates
var files embed.FS

// pageNames are the templates that make a whole page with the layout.
var pageNames = []string{"list", "report", "message"}

// renderer holds one parsed template set per page. It uses html/template, so
// every value is escaped for where it lands: all stored text is hostile.
type renderer struct {
	site   string
	style  template.CSS
	policy string
	sets   map[string]*template.Template
	app    *appParts
	feeds  bool
}

// appParts let a server-made page become the app when scripts can run: the
// app's assets, its settings, and its policy. Nil means a plain page only.
type appParts struct {
	Assets   static.EntryAssets
	Settings ui.PageSettings
	policy   string
}

// appOf returns the app's parts, or nil when the build has no app script.
func appOf(cfg *ui.Config, assets static.EntryAssets) *appParts {
	if cfg == nil || len(assets.Scripts) == 0 {
		return nil
	}
	return &appParts{Assets: assets, Settings: cfg.PageSettings(), policy: cfg.ContentSecurityPolicy()}
}

// newRenderer makes the pages. Feeds adds links that feed readers discover.
func newRenderer(site string, app *appParts, feeds bool) (*renderer, error) {
	css, err := files.ReadFile("templates/style.css")
	if err != nil {
		return nil, err
	}
	layout, err := template.ParseFS(files, "templates/layout.html")
	if err != nil {
		return nil, err
	}
	sets := make(map[string]*template.Template, len(pageNames))
	for _, name := range pageNames {
		set, err := template.Must(layout.Clone()).ParseFS(files, "templates/"+name+".html")
		if err != nil {
			return nil, err
		}
		sets[name] = set
	}
	// The style is inline, so the policy allows exactly its bytes and nothing else.
	// No script may run and nothing may be loaded.
	// With the app, the app's own policy applies, and also allows exactly these bytes.
	sum := sha256.Sum256(css)
	styleHash := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	policy := "default-src 'none'; style-src " + styleHash + "; img-src 'none'; base-uri 'none'; form-action 'none'"
	if app != nil {
		policy = strings.Replace(app.policy, "style-src 'self'", "style-src 'self' "+styleHash, 1)
	}
	return &renderer{site: site, style: template.CSS(css), policy: policy, sets: sets, app: app, feeds: feeds}, nil
}

// frame is what the layout reads. Description feeds the link-preview tags.
type frame struct {
	Site        string
	Title       string
	Description string
	Style       template.CSS
	Body        any
	App         *appParts
	Feeds       bool
}

func (v *renderer) render(out io.Writer, name, title string, body any) error {
	return v.sets[name].ExecuteTemplate(out, "layout", frame{Site: v.site, Title: title, Description: describe(body), Style: v.style, Body: body, App: v.app, Feeds: v.feeds})
}

// maxDescription is about what link previews show before cutting text.
const maxDescription = 200

// describe gives a page's one-line summary for link previews: a report's stage
// and latest update, or what a list or message page is.
func describe(body any) string {
	switch view := body.(type) {
	case reportView:
		if len(view.Updates) == 0 {
			return view.Stage.Text
		}
		return shorten(view.Stage.Text + ": " + view.Updates[0].Message)
	case listView:
		return "Published reports, unresolved first."
	case message:
		return shorten(view.Text)
	}
	return ""
}

// shorten cuts text to maxDescription characters at a word boundary, on one line.
func shorten(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if len(runes) <= maxDescription {
		return text
	}
	cut := string(runes[:maxDescription])
	if i := strings.LastIndex(cut, " "); i > maxDescription/2 {
		cut = cut[:i]
	}
	return cut + "…"
}

// message is the body of a page that only says one thing.
type message struct {
	Heading string
	Text    string
}

// stamp is a time as people read it and as machines read it. Pages have no
// script to learn the reader's time zone, so they show UTC.
type stamp struct {
	Text    string
	Machine string
}

func stampOf(t time.Time) stamp {
	t = t.UTC()
	return stamp{Text: t.Format("2 Jan 2006, 15:04 UTC"), Machine: t.Format(time.RFC3339)}
}

// label is a word to show and a class to colour it. Classes come only from the
// fixed tables below, never from stored text.
type label struct {
	Text  string
	Class string
}

var stages = map[record.Stage]label{
	record.StageInvestigating: {"Investigating", "bad"},
	record.StageIdentified:    {"Identified", "warn"},
	record.StageMonitoring:    {"Monitoring", "info"},
	record.StageResolved:      {"Resolved", "good"},
}

var impacts = map[record.Impact]label{
	record.ImpactMajor:       {"Major outage", "bad"},
	record.ImpactPartial:     {"Partial outage", "warn"},
	record.ImpactDegraded:    {"Degraded", "warn"},
	record.ImpactMaintenance: {"Maintenance", "info"},
}

func stageLabel(stage record.Stage) label {
	if l, ok := stages[stage]; ok {
		return l
	}
	return label{"Update", "info"}
}

func impactLabel(impact record.Impact) label {
	if l, ok := impacts[impact]; ok {
		return l
	}
	return label{"Affected", "info"}
}

type endpointView struct {
	Name   string
	Impact label
}

func endpointsOf(endpoints []record.AffectedEndpoint, names map[string]string) []endpointView {
	out := make([]endpointView, 0, len(endpoints))
	for _, endpoint := range endpoints {
		name, ok := names[endpoint.Key]
		if !ok {
			name = endpoint.Key
		}
		out = append(out, endpointView{Name: name, Impact: impactLabel(endpoint.Impact)})
	}
	return out
}

type updateView struct {
	Stage   label
	At      stamp
	Message string
}

// summary is one report in the list, with only its latest update.
type summary struct {
	ID        string
	Title     string
	Stage     label
	Changed   stamp
	Latest    *updateView
	Endpoints []endpointView
}

type listView struct {
	Active []summary
	Past   []summary
	Page   int
	Prev   int
	Next   int
}

func listOf(reports []*record.Report, names map[string]string, page int, more bool) listView {
	view := listView{Page: page}
	if page > 1 {
		view.Prev = page - 1
	}
	if more {
		view.Next = page + 1
	}
	for _, report := range reports {
		if !report.Published() || !record.ValidID(report.ID) {
			continue // the query already leaves drafts out; this is a second lock
		}
		item := summary{
			ID:        report.ID,
			Title:     report.Title,
			Stage:     stageLabel(report.Stage),
			Changed:   stampOf(report.UpdatedAt),
			Endpoints: endpointsOf(report.Endpoints, names),
		}
		if latest := report.LatestUpdate(); latest != nil {
			item.Latest = &updateView{Stage: stageLabel(latest.Stage), At: stampOf(latest.At), Message: latest.Message}
			item.Changed = item.Latest.At
		}
		if report.Stage == record.StageResolved {
			view.Past = append(view.Past, item)
		} else {
			view.Active = append(view.Active, item)
		}
	}
	return view
}

type reportView struct {
	Title     string
	Stage     label
	Published stamp
	Resolved  *stamp
	Endpoints []endpointView
	// Updates are newest first, as people read a running story.
	Updates []updateView
}

func reportOf(report *record.Report, names map[string]string) reportView {
	view := reportView{
		Title:     report.Title,
		Stage:     stageLabel(report.Stage),
		Endpoints: endpointsOf(report.Endpoints, names),
		Updates:   make([]updateView, 0, len(report.Updates)),
	}
	if report.PublishedAt != nil {
		view.Published = stampOf(*report.PublishedAt)
	}
	if report.ResolvedAt != nil {
		resolved := stampOf(*report.ResolvedAt)
		view.Resolved = &resolved
	}
	for i := len(report.Updates) - 1; i >= 0; i-- {
		update := report.Updates[i]
		view.Updates = append(view.Updates, updateView{Stage: stageLabel(update.Stage), At: stampOf(update.At), Message: update.Message})
	}
	return view
}

// The JSON shapes below are what the public may see. They leave out who wrote a
// report or an update, which only the admin API shows.

type publicEndpoint struct {
	Key    string        `json:"key"`
	Name   string        `json:"name"`
	Impact record.Impact `json:"impact"`
}

type publicUpdate struct {
	Stage   record.Stage `json:"stage"`
	At      time.Time    `json:"at"`
	Message string       `json:"message"`
}

type publicReport struct {
	ID          string           `json:"id"`
	Title       string           `json:"title"`
	Stage       record.Stage     `json:"stage"`
	Endpoints   []publicEndpoint `json:"endpoints"`
	Updates     []publicUpdate   `json:"updates"` // newest first; a list item has only the latest
	PublishedAt time.Time        `json:"publishedAt"`
	ResolvedAt  *time.Time       `json:"resolvedAt,omitempty"`
	UpdatedAt   time.Time        `json:"updatedAt"`
}

type publicList struct {
	Reports []publicReport `json:"reports"` // unresolved first, then most recently changed
	Page    int            `json:"page"`
	More    bool           `json:"more"`
}

func publicOf(report *record.Report, names map[string]string) publicReport {
	out := publicReport{
		ID:        report.ID,
		Title:     report.Title,
		Stage:     report.Stage,
		Endpoints: make([]publicEndpoint, 0, len(report.Endpoints)),
		Updates:   make([]publicUpdate, 0, len(report.Updates)),
		UpdatedAt: report.UpdatedAt.UTC(),
	}
	if report.ResolvedAt != nil {
		resolved := report.ResolvedAt.UTC()
		out.ResolvedAt = &resolved
	}
	if report.PublishedAt != nil {
		out.PublishedAt = report.PublishedAt.UTC()
	}
	for _, endpoint := range report.Endpoints {
		name, ok := names[endpoint.Key]
		if !ok {
			name = endpoint.Key
		}
		out.Endpoints = append(out.Endpoints, publicEndpoint{Key: endpoint.Key, Name: name, Impact: endpoint.Impact})
	}
	for i := len(report.Updates) - 1; i >= 0; i-- {
		update := report.Updates[i]
		out.Updates = append(out.Updates, publicUpdate{Stage: update.Stage, At: update.At.UTC(), Message: update.Message})
	}
	return out
}

func publicListOf(reports []*record.Report, names map[string]string, page int, more bool) publicList {
	out := publicList{Reports: make([]publicReport, 0, len(reports)), Page: page, More: more}
	for _, report := range reports {
		if !report.Published() || !record.ValidID(report.ID) {
			continue // the query already leaves drafts out; this is a second lock
		}
		out.Reports = append(out.Reports, publicOf(report, names))
	}
	return out
}
