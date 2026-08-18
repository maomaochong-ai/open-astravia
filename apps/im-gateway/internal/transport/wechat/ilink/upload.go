package ilink

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
)

// SendImageOptions describes one image send. Plaintext is the raw image
// bytes (not pre-encrypted).
type SendImageOptions struct {
	PeerUserID   string
	Plaintext    []byte
	ContextToken string
}

// SendFileOptions describes one file send. Plaintext is the raw file bytes
// (not pre-encrypted). FileName is rendered in the WeChat client as the
// download filename — empty means upstream falls back to a generic label.
type SendFileOptions struct {
	PeerUserID   string
	Plaintext    []byte
	FileName     string
	ContextToken string
}

// uploadResult is the bag of values produced by the three-step upload
// pipeline (encrypt → getuploadurl → POST ciphertext) and consumed by the
// sendmessage call.
type uploadResult struct {
	EncryptQueryParam string
	AESKey            []byte
	CiphertextSize    int
	PlaintextSize     int
}

// SendImage runs the full upload+send pipeline for an image. Returns the
// client_id used as the outbound message ID.
func (c *Client) SendImage(ctx context.Context, opts SendImageOptions) (string, error) {
	if opts.PeerUserID == "" {
		return "", fmt.Errorf("ilink: SendImage: PeerUserID required")
	}
	if len(opts.Plaintext) == 0 {
		return "", fmt.Errorf("ilink: SendImage: empty plaintext")
	}
	if c.MessagingBaseURL() == "" || c.botTokenValue() == "" {
		return "", ErrCredentialsMissing
	}
	up, err := c.uploadMedia(ctx, opts.PeerUserID, MediaTypeImage, opts.Plaintext)
	if err != nil {
		return "", err
	}
	item := MessageItem{
		Type: MessageItemTypeImage,
		ImageItem: &ImageItem{
			Media: &CDNMedia{
				EncryptQueryParam: up.EncryptQueryParam,
				AESKey:            encodeAESKeyBase64(up.AESKey),
				EncryptType:       CDNEncryptTypeAES128ECB,
			},
			MidSize: up.CiphertextSize,
			HDSize:  up.CiphertextSize,
		},
	}
	return c.sendSingleItem(ctx, opts.PeerUserID, opts.ContextToken, item)
}

// SendFile runs the full upload+send pipeline for a non-image file.
func (c *Client) SendFile(ctx context.Context, opts SendFileOptions) (string, error) {
	if opts.PeerUserID == "" {
		return "", fmt.Errorf("ilink: SendFile: PeerUserID required")
	}
	if len(opts.Plaintext) == 0 {
		return "", fmt.Errorf("ilink: SendFile: empty plaintext")
	}
	if c.MessagingBaseURL() == "" || c.botTokenValue() == "" {
		return "", ErrCredentialsMissing
	}
	up, err := c.uploadMedia(ctx, opts.PeerUserID, MediaTypeFile, opts.Plaintext)
	if err != nil {
		return "", err
	}
	fileName := opts.FileName
	if fileName == "" {
		fileName = "file.bin"
	} else {
		// Defensive: only the basename should reach the wire.
		fileName = filepath.Base(fileName)
	}
	item := MessageItem{
		Type: MessageItemTypeFile,
		FileItem: &FileItem{
			Media: &CDNMedia{
				EncryptQueryParam: up.EncryptQueryParam,
				AESKey:            encodeAESKeyBase64(up.AESKey),
				EncryptType:       CDNEncryptTypeAES128ECB,
			},
			FileName: fileName,
			MD5:      md5Hex(opts.Plaintext),
			Len:      strconv.Itoa(up.PlaintextSize),
		},
	}
	return c.sendSingleItem(ctx, opts.PeerUserID, opts.ContextToken, item)
}

// uploadMedia executes the three-step upload protocol:
//
//  1. Generate a fresh AES-128 key and PKCS7-pad/encrypt the plaintext.
//  2. POST /ilink/bot/getuploadurl with the size/md5/filekey/aeskey
//     metadata to obtain the CDN upload_param.
//  3. POST the ciphertext to the CDN URL built from upload_param + filekey,
//     and capture the x-encrypted-param response header.
//
// The returned uploadResult is everything the caller needs to assemble the
// sendmessage payload's media item.
func (c *Client) uploadMedia(ctx context.Context, peerUserID string, mediaType int, plaintext []byte) (*uploadResult, error) {
	key, err := generateAESKey()
	if err != nil {
		return nil, err
	}
	ciphertext, err := aesECBEncrypt(key, plaintext)
	if err != nil {
		return nil, err
	}
	filekey, err := generateFileKey()
	if err != nil {
		return nil, err
	}

	getReq := GetUploadUrlReq{
		FileKey:     filekey,
		MediaType:   mediaType,
		ToUserID:    peerUserID,
		RawSize:     len(plaintext),
		RawFileMD5:  md5Hex(plaintext),
		FileSize:    len(ciphertext),
		NoNeedThumb: true,
		AESKey:      encodeAESKeyHex(key),
		BaseInfo:    c.baseInfo(),
	}

	// Hit the endpoint manually instead of postJSON so we can log the raw
	// response body. Servers have been observed to return HTTP 200 with
	// ret=0 errcode=0 but an empty `upload_param` — which is functionally
	// a refusal but invisible if we only look at the structured fields.
	reqBody, err := json.Marshal(getReq)
	if err != nil {
		return nil, fmt.Errorf("ilink: marshal getuploadurl: %w", err)
	}
	raw, err := c.doHTTP(ctx, httpDoOptions{
		method:   http.MethodPost,
		baseURL:  c.MessagingBaseURL(),
		endpoint: "ilink/bot/getuploadurl",
		body:     reqBody,
		token:    c.botTokenValue(),
		timeout:  c.apiTimeout,
		label:    "getuploadurl",
	})
	if err != nil {
		return nil, err
	}
	var getResp GetUploadUrlResp
	if err := json.Unmarshal(raw, &getResp); err != nil {
		return nil, fmt.Errorf("ilink: unmarshal getuploadurl response %q: %w", truncateForLog(raw), err)
	}
	if getResp.Ret != 0 || getResp.ErrCode != 0 {
		return nil, fmt.Errorf("ilink: getuploadurl ret=%d errcode=%d errmsg=%q rawResponse=%s",
			getResp.Ret, getResp.ErrCode, getResp.ErrMsg, truncateForLog(raw))
	}
	// Pick the upload URL. Current server response uses upload_full_url
	// (fully-constructed); older code paths still emit upload_param (token
	// only). When neither is set the server quietly refused.
	uploadURL := getResp.UploadFullURL
	if uploadURL == "" && getResp.UploadParam != "" {
		uploadURL = BuildCDNUploadURL(DefaultCDNBaseURL, getResp.UploadParam, filekey)
	}
	if uploadURL == "" {
		c.logger.Warn("ilink getuploadurl returned no upload url",
			"mediaType", mediaType,
			"peerUserID", peerUserID,
			"rawsize", len(plaintext),
			"filesize", len(ciphertext),
			"rawResponse", string(raw),
		)
		return nil, fmt.Errorf("ilink: getuploadurl returned no upload url (rawResponse=%s)", truncateForLog(raw))
	}

	token, err := c.UploadCiphertext(ctx, uploadURL, ciphertext)
	if err != nil {
		return nil, err
	}
	return &uploadResult{
		EncryptQueryParam: token,
		AESKey:            key,
		CiphertextSize:    len(ciphertext),
		PlaintextSize:     len(plaintext),
	}, nil
}

// truncateForLog renders raw bytes for inclusion in an error message,
// truncating with an ellipsis to keep error strings readable.
func truncateForLog(b []byte) string {
	const limit = 512
	if len(b) <= limit {
		return string(b)
	}
	return string(b[:limit]) + "…"
}

// sendSingleItem wraps a MessageItem in the sendmessage envelope and posts
// it. Returns the client_id used as the outbound message ID.
func (c *Client) sendSingleItem(ctx context.Context, peerUserID, contextToken string, item MessageItem) (string, error) {
	cid, err := generateClientID()
	if err != nil {
		return "", fmt.Errorf("ilink: generate client_id: %w", err)
	}
	msg := &WeixinMessage{
		FromUserID:   "",
		ToUserID:     peerUserID,
		ClientID:     cid,
		MessageType:  MessageTypeBot,
		MessageState: MessageStateFinish,
		ItemList:     []MessageItem{item},
	}
	if contextToken != "" {
		msg.ContextToken = contextToken
	}
	body := SendMessageReq{
		Msg:      msg,
		BaseInfo: c.baseInfo(),
	}
	if err := c.postJSON(ctx, c.MessagingBaseURL(), "ilink/bot/sendmessage", body, nil, c.apiTimeout, "sendmessage"); err != nil {
		return "", err
	}
	return cid, nil
}
