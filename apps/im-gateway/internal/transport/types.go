package transport

import (
	"context"
	"time"
)

// InboundMessage is a normalized representation of a message arriving from any
// IM platform. Platform-specific fields MUST be flattened into the fields below
// before reaching the upper layers (router, command, bridge); the only place
// platform details may live is each transport's own internal handling code.
//
// The Raw field carries the original platform payload for the transport's own
// use (e.g. echoing a reply with platform-specific metadata) but the upper
// layers MUST NOT read it.
type InboundMessage struct {
	Platform    string       // "feishu", "mock", ...
	ChatID      string       // platform-native, opaque to upper layers
	UserID      string       // platform-native (e.g. open_id for feishu)
	MessageID   string       // platform-native
	ReplyToID   string       // empty if not a reply
	Text        string       // already stripped of @bot prefixes and command noise marker is preserved
	Attachments []Attachment // empty for first milestone (text-only)
	ReceivedAt  time.Time
	Raw         any // platform-specific, do not touch from upper layers
}

// OutboundMessage is a normalized representation of a message the upper layers
// want to deliver back to the user. The transport decides how to render it
// based on its own Capabilities (e.g. whether to use rich blocks vs flat text).
//
// Streaming hints to the transport that this is the first frame of a
// streaming response and the caller will follow up with EditMessage calls
// (and eventually EndStream). Transports that have a dedicated streaming
// path (e.g. Feishu cardkit) use it to provision the right kind of message;
// transports without one ignore the field. The bridge sets it from
// commitEdit; one-shot replies (command output, errors) leave it false.
type OutboundMessage struct {
	Text        string       // plain-text fallback; always populated even when Blocks is set
	Blocks      []Block      // optional structured content
	Attachments []Attachment // first milestone: empty
	Streaming   bool         // see doc above
}

// Block is a piece of structured content the bridge can emit. Transports
// translate it to whatever rich format their platform supports; transports
// that only do plain text simply concatenate the Text fields.
type Block struct {
	Type BlockType
	Text string
	Lang string // for BlockTypeCode
}

type BlockType string

const (
	BlockTypeText  BlockType = "text"
	BlockTypeCode  BlockType = "code"
	BlockTypeQuote BlockType = "quote"
)

// Attachment is a media attachment. Reserved for future use; first milestone
// does not implement any attachment paths but the type exists so transports
// can declare capability without breaking the interface later.
type Attachment struct {
	Kind     AttachmentKind
	Name     string
	MimeType string
	Data     []byte // small attachments inline
	URL      string // large attachments by reference
}

type AttachmentKind string

const (
	AttachmentImage AttachmentKind = "image"
	AttachmentFile  AttachmentKind = "file"
)

// Capabilities is what each transport declares about its platform's
// capabilities. The bridge reads this to decide how to deliver streaming
// content (edit-in-place vs new-message-per-chunk), how to chunk long
// outputs, etc. Capabilities are the *only* mechanism for handling
// platform differences in upper layers — there must never be code like
// `if msg.Platform == "feishu"` outside the transport package.
type Capabilities struct {
	SupportsMessageEdit bool
	SupportsCards       bool
	SupportsButtons     bool
	SupportsFileUpload  bool
	SupportsThreads     bool
	MaxMessageLength    int // 0 = unlimited
	// DeferUntilTurnEnd makes the bridge skip every intermediate
	// emission (text deltas, thinking, tool-call summaries) and instead
	// send a single digest message at agent_end. Used by transports with
	// strict per-window outbound caps where flooding chunks would burn
	// quota — currently wechat's 10-outbound-per-inbound-reset rule. The
	// bridge still emits an optional "still working" ack after a short
	// delay so the user is not left in silence on long turns.
	DeferUntilTurnEnd bool
}

// MessageHandler is what a Transport calls when an inbound message arrives.
// The handler is provided to Transport.Start() and is invoked from the
// transport's own goroutine; the handler is responsible for any internal
// fan-out / queueing.
type MessageHandler interface {
	HandleInbound(ctx context.Context, msg InboundMessage) error
}

// MessageHandlerFunc is a convenience adapter so callers can pass a plain
// function as a MessageHandler.
type MessageHandlerFunc func(ctx context.Context, msg InboundMessage) error

func (f MessageHandlerFunc) HandleInbound(ctx context.Context, msg InboundMessage) error {
	return f(ctx, msg)
}
