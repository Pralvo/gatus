package feeds

import (
	"encoding/json"
	"encoding/xml"
	"net/http"
	"time"
)

type atomLink struct {
	Rel  string `xml:"rel,attr,omitempty"`
	Type string `xml:"type,attr,omitempty"`
	Href string `xml:"href,attr"`
}

type atomText struct {
	Type string `xml:"type,attr"`
	Body string `xml:",chardata"`
}

type atomEntry struct {
	Title     string   `xml:"title"`
	ID        string   `xml:"id"`
	Published string   `xml:"published"`
	Updated   string   `xml:"updated"`
	Link      atomLink `xml:"link"`
	Content   atomText `xml:"content"`
}

type atomFeed struct {
	XMLName xml.Name    `xml:"http://www.w3.org/2005/Atom feed"`
	Title   string      `xml:"title"`
	ID      string      `xml:"id"`
	Updated string      `xml:"updated"`
	Author  atomAuthor  `xml:"author"`
	Links   []atomLink  `xml:"link"`
	Entries []atomEntry `xml:"entry"`
}

type atomAuthor struct {
	Name string `xml:"name"`
}

func (f *feed) atom(w http.ResponseWriter, r *http.Request) {
	entries := f.entries(r.Context())
	document := atomFeed{
		Title:   f.config.Title,
		ID:      f.base + "/feed/atom.xml",
		Updated: f.updated(entries).Format(time.RFC3339),
		Author:  atomAuthor{Name: f.config.Title},
		Links: []atomLink{
			{Rel: "self", Type: "application/atom+xml", Href: f.base + "/feed/atom.xml"},
			{Rel: "alternate", Type: "text/html", Href: f.base + "/"},
		},
	}
	for _, e := range entries {
		document.Entries = append(document.Entries, atomEntry{
			Title:     e.title,
			ID:        e.id,
			Published: e.published.Format(time.RFC3339),
			Updated:   e.time.Format(time.RFC3339),
			Link:      atomLink{Rel: "alternate", Type: "text/html", Href: e.link},
			Content:   atomText{Type: "text", Body: e.content},
		})
	}
	f.writeXML(w, "application/atom+xml; charset=utf-8", document)
}

type rssGUID struct {
	IsPermaLink string `xml:"isPermaLink,attr"`
	Value       string `xml:",chardata"`
}

type rssItem struct {
	Title       string  `xml:"title"`
	Link        string  `xml:"link"`
	GUID        rssGUID `xml:"guid"`
	PubDate     string  `xml:"pubDate"`
	Description string  `xml:"description"`
}

type rssChannel struct {
	Title         string    `xml:"title"`
	Link          string    `xml:"link"`
	Description   string    `xml:"description"`
	LastBuildDate string    `xml:"lastBuildDate"`
	Items         []rssItem `xml:"item"`
}

type rssFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Version string     `xml:"version,attr"`
	Channel rssChannel `xml:"channel"`
}

func (f *feed) rss(w http.ResponseWriter, r *http.Request) {
	entries := f.entries(r.Context())
	document := rssFeed{
		Version: "2.0",
		Channel: rssChannel{
			Title:         f.config.Title,
			Link:          f.base + "/",
			Description:   f.config.Title,
			LastBuildDate: f.updated(entries).Format(time.RFC1123Z),
		},
	}
	// An item's date is when it last changed, so an updated report sorts where
	// a reader expects it. Its guid stays the same.
	for _, e := range entries {
		document.Channel.Items = append(document.Channel.Items, rssItem{
			Title:       e.title,
			Link:        e.link,
			GUID:        rssGUID{IsPermaLink: "false", Value: e.id},
			PubDate:     e.time.Format(time.RFC1123Z),
			Description: e.content,
		})
	}
	f.writeXML(w, "application/rss+xml; charset=utf-8", document)
}

func (f *feed) writeXML(w http.ResponseWriter, contentType string, document any) {
	body, err := xml.MarshalIndent(document, "", "  ")
	if err != nil {
		http.Error(w, "feed unavailable", http.StatusInternalServerError)
		return
	}
	f.write(w, contentType, append([]byte(xml.Header), body...))
}

// The field names below are fixed by version 1.1 of the JSON Feed specification.
type jsonItem struct {
	ID            string `json:"id"`
	URL           string `json:"url"`
	Title         string `json:"title"`
	ContentText   string `json:"content_text"`
	DatePublished string `json:"date_published"`
	DateModified  string `json:"date_modified"`
}

type jsonFeed struct {
	Version     string     `json:"version"`
	Title       string     `json:"title"`
	HomePageURL string     `json:"home_page_url"`
	FeedURL     string     `json:"feed_url"`
	Items       []jsonItem `json:"items"`
}

func (f *feed) json(w http.ResponseWriter, r *http.Request) {
	document := jsonFeed{
		Version:     "https://jsonfeed.org/version/1.1",
		Title:       f.config.Title,
		HomePageURL: f.base + "/",
		FeedURL:     f.base + "/feed/feed.json",
		Items:       []jsonItem{},
	}
	for _, e := range f.entries(r.Context()) {
		document.Items = append(document.Items, jsonItem{
			ID:            e.id,
			URL:           e.link,
			Title:         e.title,
			ContentText:   e.content,
			DatePublished: e.published.Format(time.RFC3339),
			DateModified:  e.time.Format(time.RFC3339),
		})
	}
	body, err := json.Marshal(document)
	if err != nil {
		http.Error(w, "feed unavailable", http.StatusInternalServerError)
		return
	}
	f.write(w, "application/feed+json; charset=utf-8", body)
}
