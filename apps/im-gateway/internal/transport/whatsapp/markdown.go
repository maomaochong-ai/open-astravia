package whatsapp

import (
	"fmt"
	"regexp"
	"strings"

	"vetta-im-gateway/internal/transport"
)

// WhatsApp understands *bold*, _italic_, ~strikethrough~, `inline code` and
// ```code blocks``` natively, so most agent markdown passes through as-is.
// Only the constructs whose markdown spelling differs are converted, and only
// outside fenced code blocks:
//
//	**bold**    → *bold*
//	~~strike~~  → ~strike~
//	# Heading   → *Heading*
var (
	boldRe    = regexp.MustCompile(`\*\*(.+?)\*\*`)
	strikeRe  = regexp.MustCompile(`~~(.+?)~~`)
	headingRe = regexp.MustCompile(`(?m)^(#{1,6})[ \t]+(.+?)[ \t]*#*$`)
)

// markdownToWhatsApp converts the minimal set of markdown constructs above to
// WhatsApp formatting marks. Fenced code blocks are left untouched.
func markdownToWhatsApp(text string) string {
	segments := strings.Split(text, "```")
	// Even indices are outside code fences, odd ones inside.
	for i := 0; i < len(segments); i += 2 {
		s := segments[i]
		s = boldRe.ReplaceAllString(s, "*$1*")
		s = strikeRe.ReplaceAllString(s, "~$1~")
		s = headingRe.ReplaceAllString(s, "*$2*")
		segments[i] = s
	}
	return strings.Join(segments, "```")
}

// renderButtonsFallback renders an inline keyboard as a numbered plain-text
// list to append to the message body (WhatsApp personal accounts have no
// reliable interactive buttons). The value is shown when it differs from the
// label so the user can answer by number, label, or value.
func renderButtonsFallback(rows [][]transport.Button) string {
	var sb strings.Builder
	n := 0
	for _, row := range rows {
		for _, btn := range row {
			n++
			fmt.Fprintf(&sb, "\n%d. %s", n, btn.Text)
			if btn.Value != "" && btn.Value != btn.Text {
				sb.WriteString(" (" + btn.Value + ")")
			}
		}
	}
	if n == 0 {
		return ""
	}
	return "\n" + sb.String()
}
