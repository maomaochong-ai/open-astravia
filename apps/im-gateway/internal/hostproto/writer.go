package hostproto

import (
	"io"
	"sync"
)

// Writer is a thread-safe writer that serializes outbound event frames to
// a single io.Writer (typically the sidecar's os.Stdout). All writes are
// guarded by a mutex so concurrent goroutines can call WriteFrame without
// interleaving NDJSON lines.
type Writer struct {
	mu sync.Mutex
	w  io.Writer
}

// NewWriter wraps the given io.Writer.
func NewWriter(w io.Writer) *Writer {
	return &Writer{w: w}
}

// WriteFrame marshals v as a single NDJSON line. v should be one of the
// outbound event types (ReadyEvent, LogEvent, StatusEvent, StatePatchEvent,
// MetricEvent) with its Type field already set.
func (w *Writer) WriteFrame(v any) error {
	data, err := EncodeFrame(v)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	_, err = w.w.Write(data)
	return err
}
