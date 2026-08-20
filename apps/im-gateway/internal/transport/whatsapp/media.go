package whatsapp

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"

	"vetta-im-gateway/internal/transport"
	"vetta-im-gateway/internal/transport/inbox"
)

// mediaPart is one downloadable payload of an inbound message, described
// without touching the network so normalization stays testable.
type mediaPart struct {
	dl   whatsmeow.DownloadableMessage
	kind transport.AttachmentKind
	name string // preferred filename; empty = derive from bytes/mime
	mime string
}

// mediaParts lists the downloadable media of a message. WhatsApp messages
// carry at most one media payload; a slice keeps the per-item error handling
// uniform with the other transports.
func mediaParts(msg *waE2E.Message) []mediaPart {
	switch {
	case msg == nil:
		return nil
	case msg.GetImageMessage() != nil:
		m := msg.GetImageMessage()
		return []mediaPart{{dl: m, kind: transport.AttachmentImage, mime: m.GetMimetype()}}
	case msg.GetDocumentMessage() != nil:
		m := msg.GetDocumentMessage()
		return []mediaPart{{dl: m, kind: transport.AttachmentFile, name: m.GetFileName(), mime: m.GetMimetype()}}
	case msg.GetAudioMessage() != nil:
		m := msg.GetAudioMessage()
		return []mediaPart{{dl: m, kind: transport.AttachmentFile, mime: m.GetMimetype()}}
	case msg.GetVideoMessage() != nil:
		m := msg.GetVideoMessage()
		return []mediaPart{{dl: m, kind: transport.AttachmentFile, mime: m.GetMimetype()}}
	}
	return nil
}

// downloadAttachments downloads + persists each media part into the inbox.
// Failures on a single part are swallowed so one bad download does not drop
// the whole message.
func (t *Transport) downloadAttachments(ctx context.Context, msgID string, parts []mediaPart) []transport.Attachment {
	var out []transport.Attachment
	for i, p := range parts {
		data, err := t.client.Download(ctx, p.dl)
		if err != nil || len(data) == 0 || len(data) > MaxAttachmentBytes {
			continue
		}
		filename := inboxFilename(msgID, i, p, data)
		absPath, err := inbox.Persist(t.inboxDir, filename, data)
		if err != nil {
			continue
		}
		out = append(out, transport.Attachment{
			Kind:     p.kind,
			Name:     filepath.Base(absPath),
			MimeType: mimeOrDefault(p, absPath),
			URL:      absPath,
		})
	}
	return out
}

// inboxFilename derives the inbox filename for one media part, preferring the
// platform-supplied name, then a mime/bytes-derived extension.
func inboxFilename(msgID string, idx int, p mediaPart, data []byte) string {
	if p.name != "" {
		return fmt.Sprintf("%s-%s", inbox.SanitizeForFilename(msgID), filepath.Base(p.name))
	}
	ext := extFromMime(p.mime)
	if ext == "" {
		if p.kind == transport.AttachmentImage {
			ext = inbox.GuessImageExt(data)
		} else {
			ext = ".bin"
		}
	}
	return fmt.Sprintf("%s-media-%d%s", inbox.SanitizeForFilename(msgID), idx, ext)
}

func mimeOrDefault(p mediaPart, path string) string {
	if p.mime != "" {
		// Strip codec parameters ("audio/ogg; codecs=opus").
		return strings.TrimSpace(strings.SplitN(p.mime, ";", 2)[0])
	}
	return inbox.MimeFromExt(filepath.Ext(path))
}

// extFromMime maps the media mimetypes WhatsApp commonly sends to file
// extensions. Codec suffixes are ignored.
func extFromMime(mime string) string {
	switch strings.TrimSpace(strings.SplitN(mime, ";", 2)[0]) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "audio/ogg":
		return ".ogg"
	case "audio/mpeg":
		return ".mp3"
	case "audio/mp4", "audio/m4a":
		return ".m4a"
	case "video/mp4":
		return ".mp4"
	case "video/3gpp":
		return ".3gp"
	case "application/pdf":
		return ".pdf"
	}
	return ""
}

// mimeForUpload picks the mimetype for an outbound attachment from its file
// extension, sniffing image bytes as a fallback.
func mimeForUpload(path string, data []byte) string {
	if m := inbox.MimeFromExt(filepath.Ext(path)); m != "application/octet-stream" {
		return m
	}
	if ext := inbox.GuessImageExt(data); looksLikeImage(data) {
		return inbox.MimeFromExt(ext)
	}
	return "application/octet-stream"
}

func looksLikeImage(b []byte) bool {
	if len(b) < 12 {
		return false
	}
	switch {
	case b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G',
		b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF,
		b[0] == 'G' && b[1] == 'I' && b[2] == 'F',
		string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return true
	}
	return false
}
