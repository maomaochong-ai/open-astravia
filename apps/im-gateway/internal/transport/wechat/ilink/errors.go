package ilink

import (
	"errors"
	"fmt"
)

// ErrSessionTimeout is returned when the iLink server reports errcode -14
// on a getupdates response. This means the bot's bearer token has expired
// server-side and the user must re-bind via the QR scan flow. The transport
// surfaces this to the gateway so it can stop polling and signal the
// desktop-app to prompt a re-login.
var ErrSessionTimeout = errors.New("ilink: bot session timeout, re-login required")

// ErrCredentialsMissing is returned when a call that requires a bot token
// (e.g. GetUpdates, SendText) is made on a Client that has not yet been
// bound. Surface only — no recovery action implied.
var ErrCredentialsMissing = errors.New("ilink: client has no credentials, bind first")

// HTTPError is returned for non-2xx responses. The label identifies which
// API call failed (e.g. "sendmessage") and the body is preserved verbatim
// for debugging.
type HTTPError struct {
	Label  string
	Status int
	Body   string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("ilink: %s HTTP %d: %s", e.Label, e.Status, e.Body)
}

// TimeoutError is returned when a request was cancelled by its per-call
// deadline (i.e. a long-poll hit its client-side ceiling). Callers
// distinguish this from real network failures and treat it as a normal
// "no data, retry immediately" signal.
type TimeoutError struct {
	Label string
	Cause error
}

func (e *TimeoutError) Error() string {
	return fmt.Sprintf("ilink: %s client-side timeout: %v", e.Label, e.Cause)
}

func (e *TimeoutError) Unwrap() error { return e.Cause }

// IsTimeout reports whether err is a TimeoutError. Convenience helper for
// long-poll loops.
func IsTimeout(err error) bool {
	var t *TimeoutError
	return errors.As(err, &t)
}
