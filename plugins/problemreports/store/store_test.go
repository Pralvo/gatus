package store

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/TwiN/gatus/v5/plugins/database"
	"github.com/TwiN/gatus/v5/plugins/database/databasetest"
)

var base = time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)

func open(t *testing.T, db *database.DB) *Store {
	t.Helper()
	s := New(db)
	if err := s.Migrate(); err != nil {
		t.Fatal(err)
	}
	return s
}

func report(id string, minutes int, service, country string) Report {
	return Report{ID: id, ReceivedAt: base.Add(time.Duration(minutes) * time.Minute), Service: service, Page: "/",
		Description: "The page does not load", Country: country, Browser: "Firefox", BrowserMajor: 143, OS: "Linux"}
}

func TestStore(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		ctx := context.Background()
		s := open(t, db)
		for _, r := range []Report{
			report("PR-A", 0, "core_api", "IN"),
			report("PR-B", 10, "core_api", "DE"),
			report("PR-C", 20, "", "IN"),
			report("PR-D", 30, "core_web", ""),
		} {
			if err := s.Add(ctx, r); err != nil {
				t.Fatal(err)
			}
		}
		got, err := s.Get(ctx, "PR-B")
		if err != nil || got != report("PR-B", 10, "core_api", "DE") {
			t.Fatalf("Get = %+v, %v", got, err)
		}
		if _, err := s.Get(ctx, "PR-Z"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Get of an unknown reference: %v", err)
		}

		list := func(f Filter) []string {
			t.Helper()
			if f.Limit == 0 {
				f.Limit = 10
			}
			reports, _, err := s.List(ctx, f)
			if err != nil {
				t.Fatal(err)
			}
			var ids []string
			for _, r := range reports {
				ids = append(ids, r.ID)
			}
			return ids
		}
		check := func(name string, got, want []string) {
			t.Helper()
			if !slices.Equal(got, want) {
				t.Errorf("%s = %v, want %v", name, got, want)
			}
		}
		check("all, newest first", list(Filter{}), []string{"PR-D", "PR-C", "PR-B", "PR-A"})
		check("by service", list(Filter{Service: "core_api"}), []string{"PR-B", "PR-A"})
		check("by country", list(Filter{Country: "IN"}), []string{"PR-C", "PR-A"})
		check("from is inclusive, to is not", list(Filter{From: base.Add(10 * time.Minute), To: base.Add(30 * time.Minute)}), []string{"PR-C", "PR-B"})
		check("second page", list(Filter{Limit: 2, Offset: 2}), []string{"PR-B", "PR-A"})
		if _, more, _ := s.List(ctx, Filter{Limit: 3}); !more {
			t.Error("a page of 3 out of 4 did not say more follow")
		}
		if _, more, _ := s.List(ctx, Filter{Limit: 4}); more {
			t.Error("a page of 4 out of 4 said more follow")
		}

		countries, services, err := s.Summary(ctx, base.Add(5*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(countries, []Count{{"", 1}, {"DE", 1}, {"IN", 1}}) {
			t.Errorf("countries = %v", countries)
		}
		if !slices.Equal(services, []Count{{"", 1}, {"core_api", 1}, {"core_web", 1}}) {
			t.Errorf("services = %v", services)
		}

		if err := s.Delete(ctx, "PR-B"); err != nil {
			t.Fatal(err)
		}
		if err := s.Delete(ctx, "PR-B"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("a second delete: %v", err)
		}
		check("after delete", list(Filter{}), []string{"PR-D", "PR-C", "PR-A"})

		purged, err := s.Purge(ctx, base.Add(20*time.Minute))
		if err != nil || purged != 1 {
			t.Fatalf("Purge = %d, %v; want 1 row", purged, err)
		}
		check("after purge, the report at the cutoff stays", list(Filter{}), []string{"PR-D", "PR-C"})
	})
}

// The table holds exactly the documented fields. A column for an address, a
// raw User-Agent or a device would fail here before it reached a database.
func TestStoreKeepsOnlyTheDocumentedColumns(t *testing.T) {
	databasetest.Each(t, func(t *testing.T, db *database.DB) {
		got, err := open(t, db).Columns(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"id", "received_at", "service", "page", "description", "details", "country", "browser", "browser_major", "os"}
		if !slices.Equal(got, want) {
			t.Fatalf("columns = %v, want %v", got, want)
		}
	})
}
