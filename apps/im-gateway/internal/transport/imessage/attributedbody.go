package imessage

import (
	"bytes"
	"unicode/utf8"
)

// extractAttributedText pulls the visible text out of a message's
// attributedBody blob — the NSKeyedArchiver "typedstream" payload newer
// macOS versions store instead of populating message.text.
//
// This is a deliberate best-effort scanner, not a typedstream parser: the
// full format is undocumented and versioned, and every consumer we know
// of (mautrix-imessage, imessage-exporter, OpenClaw imsg) uses the same
// heuristic — locate the NSString object marker, then read the
// length-prefixed UTF-8 run that follows the 0x2B ('+') type byte. Any
// structural surprise returns "" so the caller falls back to dropping the
// message rather than surfacing garbage.
//
// Length encoding after the '+' byte:
//   - < 0x80: the byte itself is the length
//   - 0x81:   uint16 little-endian in the next 2 bytes
//   - 0x82:   uint32 little-endian in the next 4 bytes
func extractAttributedText(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	marker := []byte("NSString")
	idx := bytes.Index(b, marker)
	if idx == -1 {
		marker = []byte("NSMutableString")
		idx = bytes.Index(b, marker)
	}
	if idx == -1 {
		return ""
	}
	// Scan a short window past the marker for the '+' type byte that
	// precedes the length; the intervening bytes vary across versions.
	rest := b[idx+len(marker):]
	plus := bytes.IndexByte(rest, '+')
	if plus == -1 || plus > 8 {
		return ""
	}
	p := rest[plus+1:]
	if len(p) == 0 {
		return ""
	}
	var length int
	switch {
	case p[0] < 0x80:
		length = int(p[0])
		p = p[1:]
	case p[0] == 0x81:
		if len(p) < 3 {
			return ""
		}
		length = int(p[1]) | int(p[2])<<8
		p = p[3:]
	case p[0] == 0x82:
		if len(p) < 5 {
			return ""
		}
		length = int(p[1]) | int(p[2])<<8 | int(p[3])<<16 | int(p[4])<<24
		p = p[5:]
	default:
		return ""
	}
	if length <= 0 || length > len(p) {
		return ""
	}
	s := p[:length]
	if !utf8.Valid(s) {
		return ""
	}
	return string(s)
}
