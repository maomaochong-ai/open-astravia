// Package inbox holds the cross-transport logic for persisting inbound IM
// media to the [[im-gateway inbox]] — the per-day directory under the
// gateway's conversation cwd where decrypted/downloaded attachment bytes
// land before being surfaced to the agent as `@<abspath>` mentions.
//
// The persist + naming logic is identical for every transport (wechat,
// feishu, ...); only the way the raw bytes are obtained differs (wechat
// CDN-downloads + AES decrypts; feishu downloads plaintext via an
// authenticated MessageResource.Get). See ADR-0006 and ADR-0008.
package inbox

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Persist writes b under <dir>/<YYYY-MM-DD>/filename, creating the per-day
// directory on demand. Returns the absolute path that was written. A name
// collision retries with a -<n> counter suffix so an inbound file never
// silently overwrites an earlier one sharing the same name.
func Persist(dir, filename string, b []byte) (string, error) {
	dayDir := filepath.Join(dir, time.Now().Format("2006-01-02"))
	if err := os.MkdirAll(dayDir, 0o755); err != nil {
		return "", fmt.Errorf("create inbox dir: %w", err)
	}
	path := filepath.Join(dayDir, filename)
	if _, err := os.Stat(path); err == nil {
		ext := filepath.Ext(filename)
		stem := strings.TrimSuffix(filename, ext)
		for n := 1; n < 1000; n++ {
			candidate := filepath.Join(dayDir, fmt.Sprintf("%s-%d%s", stem, n, ext))
			if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
				path = candidate
				break
			}
		}
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		return "", fmt.Errorf("write inbox file: %w", err)
	}
	return path, nil
}

// SanitizeForFilename keeps only characters safe across mac/linux/windows
// filesystems. Used on msgID + filename components before joining them
// into an inbox filename.
func SanitizeForFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '-' || r == '_' || r == '.':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" {
		return "msg"
	}
	return out
}

// GuessImageExt sniffs a couple of magic bytes to pick a sensible extension
// when the protocol doesn't tell us the image format. Falls back to .jpg,
// the most common IM default.
func GuessImageExt(b []byte) string {
	if len(b) >= 8 && b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' {
		return ".png"
	}
	if len(b) >= 6 && (b[0] == 'G' && b[1] == 'I' && b[2] == 'F') {
		return ".gif"
	}
	if len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return ".webp"
	}
	return ".jpg"
}

// MimeFromExt maps a file extension (with leading dot) to a MIME type,
// defaulting to application/octet-stream for anything unrecognised.
func MimeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".pdf":
		return "application/pdf"
	case ".zip":
		return "application/zip"
	case ".mp4":
		return "video/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".txt":
		return "text/plain"
	}
	return "application/octet-stream"
}
