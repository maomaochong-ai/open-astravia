package whatsapp

import (
	"testing"

	"vetta-im-gateway/internal/transport"
)

func TestMarkdownToWhatsApp(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"plain", "hello", "hello"},
		{"bold", "**bold**", "*bold*"},
		{"bold inline", "a **b** c", "a *b* c"},
		{"multiple bold", "**a** and **b**", "*a* and *b*"},
		{"native italic preserved", "_it_", "_it_"},
		{"native single-star preserved", "*already*", "*already*"},
		{"strikethrough", "~~gone~~", "~gone~"},
		{"heading", "# Title", "*Title*"},
		{"heading depth", "### Sub", "*Sub*"},
		{"heading mid-text line", "line\n## H\nrest", "line\n*H*\nrest"},
		// Only fenced blocks are protected; inline code is converted too,
		// which is harmless for the agent's typical output.
		{"inline code converted", "`**x**`", "`*x*`"},
		{"fenced code untouched", "```\n**not bold**\n```", "```\n**not bold**\n```"},
		{"fenced with lang", "before **b**\n```go\n**raw**\n```\nafter **c**", "before *b*\n```go\n**raw**\n```\nafter *c*"},
		{"empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := markdownToWhatsApp(tc.in); got != tc.want {
				t.Fatalf("markdownToWhatsApp(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestRenderButtonsFallback(t *testing.T) {
	cases := []struct {
		name string
		in   [][]transport.Button
		want string
	}{
		{"nil", nil, ""},
		{"empty rows", [][]transport.Button{{}}, ""},
		{
			"single",
			[][]transport.Button{{{Text: "Yes", Value: "yes"}}},
			"\n\n1. Yes (yes)",
		},
		{
			"value equals text collapses",
			[][]transport.Button{{{Text: "ok", Value: "ok"}}},
			"\n\n1. ok",
		},
		{
			"numbering spans rows",
			[][]transport.Button{
				{{Text: "A", Value: "a"}, {Text: "B", Value: "b"}},
				{{Text: "C", Value: "c"}},
			},
			"\n\n1. A (a)\n2. B (b)\n3. C (c)",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := renderButtonsFallback(tc.in); got != tc.want {
				t.Fatalf("renderButtonsFallback = %q, want %q", got, tc.want)
			}
		})
	}
}
