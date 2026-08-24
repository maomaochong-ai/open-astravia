package ilink

import (
	"bytes"
	"crypto/rand"
	"testing"
)

// aesECBPaddedSize is the documented contract for the ciphertext length the
// WeChat CDN expects on the wire, and aesECBEncrypt's doc comment points at
// it. Pin the two together so neither can drift: PKCS7 here always appends
// at least one full block, matching Node crypto's default padding.
func TestAESECBPaddedSize_MatchesEncryptOutput(t *testing.T) {
	key := make([]byte, 16)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("generate key: %v", err)
	}

	// Cover both sides of every block boundary, including the exact-multiple
	// case where a whole block of padding must still be appended.
	for _, n := range []int{0, 1, 15, 16, 17, 31, 32, 33, 100} {
		plaintext := make([]byte, n)
		if _, err := rand.Read(plaintext); err != nil {
			t.Fatalf("generate plaintext: %v", err)
		}

		ciphertext, err := aesECBEncrypt(key, plaintext)
		if err != nil {
			t.Fatalf("encrypt %d bytes: %v", n, err)
		}

		want := aesECBPaddedSize(n)
		if len(ciphertext) != want {
			t.Errorf("plaintext %d bytes: ciphertext is %d bytes, aesECBPaddedSize says %d",
				n, len(ciphertext), want)
		}
		if len(ciphertext)%CDNAESBlockSize != 0 {
			t.Errorf("plaintext %d bytes: ciphertext %d is not a whole number of blocks",
				n, len(ciphertext))
		}
		if len(ciphertext) <= n {
			t.Errorf("plaintext %d bytes: ciphertext %d must grow by at least one padding block",
				n, len(ciphertext))
		}
	}
}

func TestAESECBEncrypt_RejectsWrongKeySize(t *testing.T) {
	for _, size := range []int{0, 8, 15, 17, 32} {
		if _, err := aesECBEncrypt(bytes.Repeat([]byte{1}, size), []byte("hi")); err == nil {
			t.Errorf("key size %d: expected an error", size)
		}
	}
}
