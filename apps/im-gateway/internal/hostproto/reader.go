package hostproto

import (
	"bufio"
	"context"
	"errors"
	"io"
)

// Reader streams inbound frames from a parent process via stdin.
//
// Frames are NDJSON (one JSON object per line). EOF on the underlying reader
// is treated as an implicit shutdown signal — the channel is closed and
// callers should treat that as semantically equivalent to receiving a
// ShutdownFrame.
type Reader struct {
	scanner *bufio.Scanner
	frames  chan any
	errCh   chan error
}

// NewReader wraps an io.Reader. The buffer is large enough to handle init
// frames containing dozens of projects + state entries (1 MiB hard cap).
func NewReader(r io.Reader) *Reader {
	const maxLine = 1 << 20
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), maxLine)
	return &Reader{
		scanner: sc,
		frames:  make(chan any, 8),
		errCh:   make(chan error, 1),
	}
}

// Run pumps frames into the channels. Returns when the underlying reader
// hits EOF, the context is cancelled, or a malformed line is encountered.
//
// Run owns the lifecycle of the frame channel — it always closes the
// channel before returning. Errors (including non-EOF read errors and parse
// errors) are written to errCh exactly once before close.
func (r *Reader) Run(ctx context.Context) {
	defer close(r.frames)

	for r.scanner.Scan() {
		line := r.scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		// Make a copy: scanner reuses the underlying buffer between calls.
		buf := make([]byte, len(line))
		copy(buf, line)

		frame, err := DecodeInbound(buf)
		if err != nil {
			select {
			case r.errCh <- err:
			default:
			}
			return
		}

		select {
		case r.frames <- frame:
		case <-ctx.Done():
			return
		}
	}

	if err := r.scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		select {
		case r.errCh <- err:
		default:
		}
	}
}

// Frames returns the channel of decoded inbound frames. Closed when Run
// returns (i.e. EOF or error).
func (r *Reader) Frames() <-chan any {
	return r.frames
}

// Err returns a channel that receives at most one error if Run terminates
// due to a read failure or parse failure. EOF on its own is not an error.
func (r *Reader) Err() <-chan error {
	return r.errCh
}
