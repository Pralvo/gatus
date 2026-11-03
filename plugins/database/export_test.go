package database

import (
	"testing"
	"time"
)

// SetRetryDelayForTest shortens the host's retry for one test.
func SetRetryDelayForTest(t *testing.T, delay time.Duration) {
	t.Helper()
	old := retryDelay
	retryDelay = delay
	t.Cleanup(func() { retryDelay = old })
}

// RedactForTest exposes redaction.
func RedactForTest(c Config, err error) error { return c.redact(err) }

// NewForTest returns a DB with no connection, for pure functions.
func NewForTest(dialect Dialect) *DB { return &DB{dialect: dialect} }
