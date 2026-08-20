package telegram

import "strings"

// markdownToHTML converts the agent's markdown subset to Telegram HTML
// (parse_mode=HTML). Supported: **bold**, *italic*, `code`, ``` fenced
// blocks (optional language on the fence line), and [text](url) links.
// Everything else — including headings and lists — passes through as
// escaped text, which Telegram renders literally; that is deliberate, as
// Telegram HTML has no block-level markup beyond <pre>.
//
// Pure function; the caller falls back to sending the raw markdown as
// plain text if Telegram still rejects the produced entities.
func markdownToHTML(md string) string {
	var b strings.Builder
	for {
		idx := strings.Index(md, "```")
		if idx < 0 {
			writeInline(&b, md)
			break
		}
		writeInline(&b, md[:idx])
		rest := md[idx+3:]
		end := strings.Index(rest, "```")
		if end < 0 {
			// Unterminated fence: treat the remainder as code rather than
			// dropping it.
			writeFence(&b, rest)
			break
		}
		writeFence(&b, rest[:end])
		md = rest[end+3:]
	}
	return b.String()
}

// writeFence renders one fenced block body (the text between the ```
// markers). The first line is the optional language tag.
func writeFence(b *strings.Builder, body string) {
	lang := ""
	code := body
	if nl := strings.IndexByte(body, '\n'); nl >= 0 {
		firstLine := strings.TrimSpace(body[:nl])
		// The fence line is consumed either way: it is the language tag or
		// just the newline after the opening ```. A first line containing
		// spaces is real code (no fence tag), so it stays.
		if !strings.ContainsAny(firstLine, " \t") {
			lang = firstLine
			code = body[nl+1:]
		}
	}
	code = strings.TrimSuffix(code, "\n")
	if lang != "" {
		b.WriteString(`<pre><code class="language-` + escapeHTML(lang) + `">`)
		b.WriteString(escapeHTML(code))
		b.WriteString("</code></pre>")
		return
	}
	b.WriteString("<pre>")
	b.WriteString(escapeHTML(code))
	b.WriteString("</pre>")
}

// writeInline renders inline markdown (bold / italic / code / links) into
// b, escaping &<> in all text content. Bold and italic bodies are rendered
// recursively so nesting like **bold with `code`** works; code spans and
// link URLs are always literal.
func writeInline(b *strings.Builder, s string) {
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == '`':
			if j := strings.IndexByte(s[i+1:], '`'); j >= 0 {
				b.WriteString("<code>")
				b.WriteString(escapeHTML(s[i+1 : i+1+j]))
				b.WriteString("</code>")
				i += j + 2
				continue
			}
		case strings.HasPrefix(s[i:], "**"):
			if j := strings.Index(s[i+2:], "**"); j >= 0 {
				b.WriteString("<b>")
				writeInline(b, s[i+2:i+2+j])
				b.WriteString("</b>")
				i += j + 4
				continue
			}
		case c == '*':
			if j := strings.IndexByte(s[i+1:], '*'); j > 0 {
				b.WriteString("<i>")
				writeInline(b, s[i+1:i+1+j])
				b.WriteString("</i>")
				i += j + 2
				continue
			}
		case c == '[':
			if text, url, n, ok := parseLink(s[i:]); ok {
				b.WriteString(`<a href="` + escapeHTML(url) + `">`)
				writeInline(b, text)
				b.WriteString("</a>")
				i += n
				continue
			}
		}
		writeEscapedByte(b, c)
		i++
	}
}

// parseLink matches a leading [text](url) and returns its parts plus the
// number of bytes consumed.
func parseLink(s string) (text, url string, n int, ok bool) {
	closeBracket := strings.IndexByte(s, ']')
	if closeBracket < 0 || closeBracket+1 >= len(s) || s[closeBracket+1] != '(' {
		return "", "", 0, false
	}
	closeParen := strings.IndexByte(s[closeBracket+1:], ')')
	if closeParen < 0 {
		return "", "", 0, false
	}
	text = s[1:closeBracket]
	url = s[closeBracket+2 : closeBracket+1+closeParen]
	if url == "" {
		return "", "", 0, false
	}
	return text, url, closeBracket + closeParen + 2, true
}

func writeEscapedByte(b *strings.Builder, c byte) {
	switch c {
	case '&':
		b.WriteString("&amp;")
	case '<':
		b.WriteString("&lt;")
	case '>':
		b.WriteString("&gt;")
	default:
		b.WriteByte(c)
	}
}

func escapeHTML(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return r.Replace(s)
}
