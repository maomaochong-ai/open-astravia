package inbox

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPersist_WritesUnderDayDir(t *testing.T) {
	dir := t.TempDir()
	abs, err := Persist(dir, "msg-img-0.png", []byte("hello"))
	if err != nil {
		t.Fatal(err)
	}
	day := time.Now().Format("2006-01-02")
	wantDir := filepath.Join(dir, day)
	if filepath.Dir(abs) != wantDir {
		t.Errorf("parent dir: got %q want %q", filepath.Dir(abs), wantDir)
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "hello" {
		t.Errorf("content: %q", b)
	}
}

func TestPersist_CollisionGetsSuffix(t *testing.T) {
	dir := t.TempDir()
	first, err := Persist(dir, "dup.txt", []byte("a"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := Persist(dir, "dup.txt", []byte("b"))
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("collision should produce distinct paths")
	}
	if filepath.Base(second) != "dup-1.txt" {
		t.Errorf("expected -1 suffix, got %q", filepath.Base(second))
	}
}

func TestSanitizeForFilename(t *testing.T) {
	cases := map[string]string{
		"om_abc-123": "om_abc-123",
		"a/b\\c:d":   "a_b_c_d",
		"中文":         "__", // each rune replaced
		"":           "msg",
	}
	for in, want := range cases {
		if got := SanitizeForFilename(in); got != want {
			t.Errorf("SanitizeForFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestGuessImageExt(t *testing.T) {
	png := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	if got := GuessImageExt(png); got != ".png" {
		t.Errorf("png: %q", got)
	}
	gif := []byte("GIF89a")
	if got := GuessImageExt(gif); got != ".gif" {
		t.Errorf("gif: %q", got)
	}
	if got := GuessImageExt([]byte("\xff\xd8\xff")); got != ".jpg" {
		t.Errorf("jpeg fallback: %q", got)
	}
}

func TestMimeFromExt(t *testing.T) {
	if got := MimeFromExt(".PNG"); got != "image/png" {
		t.Errorf("case-insensitive png: %q", got)
	}
	if got := MimeFromExt(".unknown"); got != "application/octet-stream" {
		t.Errorf("default: %q", got)
	}
}
