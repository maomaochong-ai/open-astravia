// Package protocol defines the wire format spoken between the Vetta desktop
// app and the helper running on a remote project host.
//
// Framing is newline-delimited JSON over the SSH channel's stdio. Binary
// payloads travel as base64 so a frame never contains a raw newline.
package protocol

import "encoding/json"

// Version is the semantic protocol version. It names the install directory on
// the remote host and is checked during the handshake.
//
// It is deliberately NOT a build hash (ADR-0124): a hash changes on every app
// release, so an upgraded client could never reattach to a daemon that is still
// supervising the user's running tasks. Bump the major only for changes an
// older peer cannot ignore.
const Version = "1.0.0"

// Request is a client-to-helper call. ID is echoed in the matching Response.
type Request struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

// Response answers exactly one Request.
type Response struct {
	ID     uint64 `json:"id"`
	Result any    `json:"result,omitempty"`
	Error  *Error `json:"error,omitempty"`
}

// Notification is a helper-initiated message with no ID (watch events, process
// output). Clients must ignore methods they do not know.
type Notification struct {
	Method string `json:"method"`
	Params any    `json:"params"`
}

// Error codes mirror the distinction the desktop side already makes: "the
// remote answered no" is different from "the remote could not be asked".
const (
	CodeNotFound      = "ENOENT"
	CodeExists        = "EEXIST"
	CodeInvalid       = "EINVAL"
	CodeConflict      = "ECONFLICT"
	CodeUnknownMethod = "ENOSYS"
	CodeInternal      = "EIO"
)

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func Errorf(code, message string) *Error { return &Error{Code: code, Message: message} }
