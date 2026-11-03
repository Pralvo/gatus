package sqlstore

// migrationOwner names this package's schema versions.
const migrationOwner = "incidents"

// migrations must only grow at the end. Times are UTC milliseconds since the
// epoch, which sort and compare the same on both databases. Reports are linked
// from incidents by a plain ID with no foreign key, so neither record reaches
// into the other.
var migrations = []string{`
CREATE TABLE incident_records (
	id         TEXT PRIMARY KEY,
	title      TEXT   NOT NULL,
	severity   TEXT   NOT NULL,
	commander  TEXT   NOT NULL,
	state      TEXT   NOT NULL,
	postmortem TEXT   NOT NULL,
	report_id  TEXT   NOT NULL,
	created_by TEXT   NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);
CREATE TABLE incident_timeline (
	incident_id TEXT   NOT NULL REFERENCES incident_records (id),
	seq         BIGINT NOT NULL,
	happened_at BIGINT NOT NULL,
	actor       TEXT   NOT NULL,
	kind        TEXT   NOT NULL,
	from_value  TEXT   NOT NULL,
	to_value    TEXT   NOT NULL,
	note        TEXT   NOT NULL,
	PRIMARY KEY (incident_id, seq)
);
CREATE TABLE status_reports (
	id           TEXT PRIMARY KEY,
	title        TEXT   NOT NULL,
	stage        TEXT   NOT NULL,
	published_at BIGINT,
	resolved_at  BIGINT,
	created_by   TEXT   NOT NULL,
	created_at   BIGINT NOT NULL,
	updated_at   BIGINT NOT NULL
);
CREATE TABLE status_report_endpoints (
	report_id    TEXT NOT NULL REFERENCES status_reports (id),
	endpoint_key TEXT NOT NULL,
	impact       TEXT NOT NULL,
	PRIMARY KEY (report_id, endpoint_key)
);
CREATE TABLE status_report_updates (
	report_id   TEXT   NOT NULL REFERENCES status_reports (id),
	seq         BIGINT NOT NULL,
	happened_at BIGINT NOT NULL,
	actor       TEXT   NOT NULL,
	stage       TEXT   NOT NULL,
	message     TEXT   NOT NULL,
	PRIMARY KEY (report_id, seq)
);
CREATE INDEX incident_records_by_time ON incident_records (created_at);
CREATE INDEX status_reports_by_time ON status_reports (updated_at);
`}
