package record

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Limits on stored text and lists.
const (
	MaxTitleLength      = 200
	MaxNameLength       = 100
	MaxTextLength       = 5_000
	MaxPostmortemLength = 100_000
	MaxEndpointKey      = 300
	MaxEndpoints        = 100

	// DefaultLimit and MaxLimit bound a list.
	DefaultLimit = 50
	MaxLimit     = 200
)

var moves = map[State][]State{
	StateOpen:      {StateMitigated, StateResolved, StateCancelled},
	StateMitigated: {StateOpen, StateResolved, StateCancelled},
	StateResolved:  {StateOpen, StateClosed},
	StateCancelled: {StateOpen, StateClosed},
}

// CanMove reports whether an incident may go from one state to another. Any
// state but closed can go back to open, and closed is reached only from resolved
// or cancelled.
func CanMove(from, to State) bool { return slices.Contains(moves[from], to) }

func (s Severity) valid() bool {
	return s == SeverityCritical || s == SeverityMajor || s == SeverityMinor
}

func (s State) valid() bool {
	_, hasMoves := moves[s]
	return hasMoves || s == StateClosed
}

func (s Stage) valid() bool {
	return s == StageInvestigating || s == StageIdentified || s == StageMonitoring || s == StageResolved
}

func (i Impact) valid() bool { return impactRank[i] > 0 }

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// checkLine validates text that must stay on one line.
func checkLine(field, value string, limit int) error {
	return checkText(field, value, limit, func(r rune) bool { return unicode.IsControl(r) })
}

// checkBlock validates text that may span lines.
func checkBlock(field, value string, limit int) error {
	return checkText(field, value, limit, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t'
	})
}

func checkText(field, value string, limit int, refused func(rune) bool) error {
	if !utf8.ValidString(value) {
		return invalid("%s is not valid text", field)
	}
	if utf8.RuneCountInString(value) > limit {
		return invalid("%s is longer than %d characters", field, limit)
	}
	if strings.IndexFunc(value, refused) >= 0 {
		return invalid("%s holds a control character", field)
	}
	return nil
}

func required(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return invalid("%s is required", field)
	}
	return nil
}

func checkTitle(title string) error {
	if err := required("title", title); err != nil {
		return err
	}
	return checkLine("title", title, MaxTitleLength)
}

func checkMessage(field, message string) error {
	if err := required(field, message); err != nil {
		return err
	}
	return checkBlock(field, message, MaxTextLength)
}

func checkActor(actor string) error {
	if err := required("actor", actor); err != nil {
		return err
	}
	return checkLine("actor", actor, MaxNameLength)
}

func checkSeverity(severity Severity) error {
	if !severity.valid() {
		return invalid("severity must be critical, major or minor")
	}
	return nil
}

func checkStage(stage Stage) error {
	if !stage.valid() {
		return invalid("stage must be investigating, identified, monitoring or resolved")
	}
	return nil
}

// bound applies the default and the cap to a list window.
func bound(limit, offset int) (int, int, error) {
	if limit < 0 || offset < 0 {
		return 0, 0, invalid("limit and offset cannot be negative")
	}
	if limit == 0 {
		limit = DefaultLimit
	}
	return min(limit, MaxLimit), offset, nil
}
