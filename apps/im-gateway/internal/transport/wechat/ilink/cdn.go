package ilink

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// CDN protocol constants. The CDN host is separate from the per-account
// messaging baseurl returned at QR-confirm time; the upstream client uses
// a single fixed hostname for all WeChat bot media. See
// apps/im-gateway/docs/ilink-protocol.md §1.7 / §4.
const (
	// DefaultCDNBaseURL is the constant used by upstream
	// @tencent-weixin/openclaw-weixin. Sniffing in the wild has never
	// observed a different host for bot media. No trailing slash.
	DefaultCDNBaseURL = "https://novac2c.cdn.weixin.qq.com/c2c"

	// CDNDownloadPath is the path suffix for media download.
	CDNDownloadPath = "/download"

	// CDNUploadPath is the path suffix for ciphertext upload (POST).
	CDNUploadPath = "/upload"

	// CDNUploadResultParamHeader is the response header from the upload
	// endpoint that carries the "encrypted_query_param" downstream
	// consumers (sendmessage payload) must echo as media.encrypt_query_param.
	CDNUploadResultParamHeader = "x-encrypted-param"

	// CDNUploadErrorHeader is the response header carrying server-side
	// upload error messages.
	CDNUploadErrorHeader = "x-error-message"

	// CDNMaxDownloadBytes caps the size of a single media we will hold in
	// memory. 100 MB matches the upstream save guard in
	// src/cdn/media/media-download.ts.
	CDNMaxDownloadBytes = 100 * 1024 * 1024

	// CDNAESBlockSize = aes.BlockSize (16). Spelled out here so callers
	// computing padded ciphertext sizes can do so without importing crypto/aes.
	CDNAESBlockSize = aes.BlockSize

	// CDNEncryptTypeAES128ECB is the value to set on CDNMedia.encrypt_type
	// for AES-128-ECB encrypted payloads. Upstream constant.
	CDNEncryptTypeAES128ECB = 1
)

var hexRegexp = regexp.MustCompile(`^[0-9a-fA-F]{32}$`)

// parseAESKey accepts either of the two on-wire encodings used by upstream
// and returns the raw 16 bytes:
//
//   - Newer media.aes_key: base64(16 raw bytes) → 24 chars incl `=` padding.
//   - Legacy image_item.aeskey: 32-char hex of 16 raw bytes (may itself be
//     wrapped in base64, in which case base64-decoding yields the 32 ASCII
//     hex chars).
//
// Returns an error if the input is neither shape.
func parseAESKey(s string) ([]byte, error) {
	if s == "" {
		return nil, errors.New("ilink: AES key is empty")
	}
	// 1. Try as raw 32-char hex first.
	if hexRegexp.MatchString(s) {
		b, err := hex.DecodeString(s)
		if err == nil && len(b) == 16 {
			return b, nil
		}
	}
	// 2. Try base64.
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		// Some servers use URL-safe base64 / no-padding variants.
		decoded, err = base64.RawStdEncoding.DecodeString(strings.TrimRight(s, "="))
		if err != nil {
			return nil, fmt.Errorf("ilink: AES key is neither hex nor base64: %w", err)
		}
	}
	if len(decoded) == 16 {
		return decoded, nil
	}
	// 3. base64-of-ASCII-hex case.
	if len(decoded) == 32 && hexRegexp.Match(decoded) {
		raw, err := hex.DecodeString(string(decoded))
		if err == nil && len(raw) == 16 {
			return raw, nil
		}
	}
	return nil, fmt.Errorf("ilink: AES key has unexpected length %d", len(decoded))
}

// encodeAESKeyBase64 produces the on-wire form used by media.aes_key in
// outbound sendmessage payloads.
//
// CRITICAL: this is **double-encoded** — base64 of the ASCII hex string,
// NOT base64 of the 16 raw bytes. Upstream ts does:
//
//	Buffer.from(aeskeyHexString).toString("base64")
//
// where the argument is the 32-char lowercase hex (treated as UTF-8). The
// receiver's parseAesKey first base64-decodes, gets 32 ASCII hex chars,
// THEN hex-decodes to the 16 raw bytes. parseAesKey accepts both shapes
// on inbound, but the WeChat **client** appears to only render outbound
// media when this exact double-encoded shape is used — sending raw 16-byte
// base64 makes sendmessage succeed but the message never appears in the
// recipient's chat. Don't simplify to plain base64(key).
func encodeAESKeyBase64(key []byte) string {
	return base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString(key)))
}

// encodeAESKeyHex produces the on-wire form used by getuploadurl's `aeskey`
// field (32-char lowercase hex of 16 raw bytes).
func encodeAESKeyHex(key []byte) string {
	return hex.EncodeToString(key)
}

// generateAESKey returns 16 fresh random bytes suitable for AES-128.
func generateAESKey() ([]byte, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("ilink: generate aes key: %w", err)
	}
	return b, nil
}

// generateFileKey returns the random hex token upstream uses as the
// `filekey` parameter on getuploadurl (16 raw bytes → 32 hex chars).
func generateFileKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("ilink: generate filekey: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// aesECBPaddedSize returns the ciphertext length AES-128-ECB + PKCS7 will
// produce for a plaintext of n bytes. Matches Node crypto's default
// padding: always at least one full block appended.
func aesECBPaddedSize(n int) int {
	return ((n / CDNAESBlockSize) + 1) * CDNAESBlockSize
}

// aesECBEncrypt encrypts plaintext under key with AES-128-ECB and PKCS7
// padding. Returns the ciphertext (whose length is aesECBPaddedSize).
//
// ECB on its own is broken for general use, but here we are byte-for-byte
// matching what the WeChat CDN expects on the wire. Do not reuse this for
// anything else.
func aesECBEncrypt(key, plaintext []byte) ([]byte, error) {
	if len(key) != 16 {
		return nil, fmt.Errorf("ilink: AES key must be 16 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("ilink: new AES cipher: %w", err)
	}
	padded := pkcs7Pad(plaintext, CDNAESBlockSize)
	out := make([]byte, len(padded))
	for i := 0; i < len(padded); i += CDNAESBlockSize {
		block.Encrypt(out[i:i+CDNAESBlockSize], padded[i:i+CDNAESBlockSize])
	}
	return out, nil
}

// aesECBDecrypt is the inverse of aesECBEncrypt. PKCS7 padding is stripped.
func aesECBDecrypt(key, ciphertext []byte) ([]byte, error) {
	if len(key) != 16 {
		return nil, fmt.Errorf("ilink: AES key must be 16 bytes, got %d", len(key))
	}
	if len(ciphertext) == 0 || len(ciphertext)%CDNAESBlockSize != 0 {
		return nil, fmt.Errorf("ilink: ciphertext length %d is not a multiple of block size", len(ciphertext))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("ilink: new AES cipher: %w", err)
	}
	out := make([]byte, len(ciphertext))
	for i := 0; i < len(ciphertext); i += CDNAESBlockSize {
		block.Decrypt(out[i:i+CDNAESBlockSize], ciphertext[i:i+CDNAESBlockSize])
	}
	return pkcs7Unpad(out, CDNAESBlockSize)
}

func pkcs7Pad(b []byte, blockSize int) []byte {
	pad := blockSize - len(b)%blockSize
	out := make([]byte, len(b)+pad)
	copy(out, b)
	for i := len(b); i < len(out); i++ {
		out[i] = byte(pad)
	}
	return out
}

func pkcs7Unpad(b []byte, blockSize int) ([]byte, error) {
	n := len(b)
	if n == 0 || n%blockSize != 0 {
		return nil, errors.New("ilink: pkcs7 unpad: bad length")
	}
	pad := int(b[n-1])
	if pad == 0 || pad > blockSize {
		return nil, fmt.Errorf("ilink: pkcs7 unpad: bad padding byte %d", pad)
	}
	if pad > n {
		return nil, errors.New("ilink: pkcs7 unpad: padding exceeds buffer")
	}
	for i := n - pad; i < n; i++ {
		if int(b[i]) != pad {
			return nil, errors.New("ilink: pkcs7 unpad: inconsistent padding bytes")
		}
	}
	return b[:n-pad], nil
}

// md5Hex returns the lowercase 32-char hex md5 of b. Used by getuploadurl's
// `rawfilemd5` field, which is hashed over the plaintext (not ciphertext).
func md5Hex(b []byte) string {
	sum := md5.Sum(b)
	return hex.EncodeToString(sum[:])
}

// =============================================================================
// CDN URL builders (mirrors src/cdn/cdn-url.ts)
// =============================================================================

// BuildCDNDownloadURL produces the GET URL for downloading encrypted media
// referenced by CDNMedia.EncryptQueryParam.
func BuildCDNDownloadURL(cdnBaseURL, encryptedQueryParam string) string {
	base := cdnBaseURL
	if base == "" {
		base = DefaultCDNBaseURL
	}
	return base + CDNDownloadPath + "?encrypted_query_param=" + url.QueryEscape(encryptedQueryParam)
}

// BuildCDNUploadURL produces the POST URL for uploading ciphertext.
//
// Upstream uses the same query-param name "encrypted_query_param" for the
// upload_param returned by getuploadurl. The `filekey` we send here is the
// same one we passed into the getuploadurl request body.
func BuildCDNUploadURL(cdnBaseURL, uploadParam, filekey string) string {
	base := cdnBaseURL
	if base == "" {
		base = DefaultCDNBaseURL
	}
	q := url.Values{}
	q.Set("encrypted_query_param", uploadParam)
	q.Set("filekey", filekey)
	return base + CDNUploadPath + "?" + q.Encode()
}

// =============================================================================
// CDN download + upload helpers
// =============================================================================

// DownloadAndDecrypt fetches the ciphertext at the URL produced by
// BuildCDNDownloadURL, then AES-128-ECB decrypts it under aesKey.
//
// aesKeyStr accepts either media.aes_key (base64) or legacy
// image_item.aeskey (hex); see parseAESKey for details. When aesKeyStr is
// empty the body is returned as-is (matches upstream "plain CDN" path).
func (c *Client) DownloadAndDecrypt(ctx context.Context, downloadURL, aesKeyStr string) ([]byte, error) {
	if downloadURL == "" {
		return nil, errors.New("ilink: download url required")
	}

	dlCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return nil, fmt.Errorf("ilink: build cdn download req: %w", err)
	}
	resp, err := c.httpc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ilink: cdn download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, &HTTPError{Label: "cdn download", Status: resp.StatusCode, Body: string(body)}
	}

	ciphertext, err := io.ReadAll(io.LimitReader(resp.Body, CDNMaxDownloadBytes+1))
	if err != nil {
		return nil, fmt.Errorf("ilink: cdn download read body: %w", err)
	}
	if len(ciphertext) > CDNMaxDownloadBytes {
		return nil, fmt.Errorf("ilink: cdn download exceeds %d-byte cap", CDNMaxDownloadBytes)
	}

	if aesKeyStr == "" {
		// Plain (non-encrypted) media. Rare; mirror upstream which calls
		// downloadPlainCdnBuffer in this case.
		return ciphertext, nil
	}
	key, err := parseAESKey(aesKeyStr)
	if err != nil {
		return nil, err
	}
	plaintext, err := aesECBDecrypt(key, ciphertext)
	if err != nil {
		return nil, fmt.Errorf("ilink: aes decrypt: %w", err)
	}
	return plaintext, nil
}

// UploadCiphertext POSTs the AES-128-ECB ciphertext to the CDN URL produced
// by BuildCDNUploadURL and returns the `encrypt_query_param` token the
// caller must include in the subsequent sendmessage payload's CDNMedia.
//
// On 5xx the call is retried up to 3 times with a short pause between
// attempts (matching upstream's behavior). 4xx aborts immediately.
func (c *Client) UploadCiphertext(ctx context.Context, uploadURL string, ciphertext []byte) (string, error) {
	if uploadURL == "" {
		return "", errors.New("ilink: upload url required")
	}
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		upCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		req, err := http.NewRequestWithContext(upCtx, http.MethodPost, uploadURL, bytes.NewReader(ciphertext))
		if err != nil {
			cancel()
			return "", fmt.Errorf("ilink: build cdn upload req: %w", err)
		}
		req.Header.Set("Content-Type", "application/octet-stream")
		req.ContentLength = int64(len(ciphertext))

		resp, err := c.httpc.Do(req)
		if err != nil {
			cancel()
			lastErr = fmt.Errorf("ilink: cdn upload transport: %w", err)
			c.logger.Warn("cdn upload transport error", "attempt", attempt, "err", err)
			if attempt < maxAttempts {
				time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
				continue
			}
			return "", lastErr
		}
		token := resp.Header.Get(CDNUploadResultParamHeader)
		errMsg := resp.Header.Get(CDNUploadErrorHeader)
		// Drain + close so the connection can be reused.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
		_ = resp.Body.Close()
		cancel()

		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("ilink: cdn upload HTTP %d (%s)", resp.StatusCode, errMsg)
			c.logger.Warn("cdn upload 5xx, retrying", "attempt", attempt, "status", resp.StatusCode, "err", errMsg)
			if attempt < maxAttempts {
				time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
				continue
			}
			return "", lastErr
		}
		if resp.StatusCode >= 400 {
			return "", fmt.Errorf("ilink: cdn upload HTTP %d (%s)", resp.StatusCode, errMsg)
		}
		if token == "" {
			return "", fmt.Errorf("ilink: cdn upload OK but missing %s header (err=%q)", CDNUploadResultParamHeader, errMsg)
		}
		return token, nil
	}
	return "", lastErr
}
