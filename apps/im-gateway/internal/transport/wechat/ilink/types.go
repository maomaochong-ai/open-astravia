// Package ilink is a Go client for the WeChat iLink bot protocol.
//
// Reverse-engineered from @tencent-weixin/openclaw-weixin@2.1.7 (npm), whose
// TypeScript source ships unobfuscated. See
// apps/im-gateway/docs/ilink-protocol.md for the full reference and the
// upstream file mapping. This package implements only the subset needed by
// im-gateway: scan-to-bind, long-poll receive, and text send. Media upload,
// streaming, typing indicators, and group chat are explicitly out of scope
// for the first milestone.
//
// All HTTP traffic is JSON. The wire-level field names in the structs below
// must match the upstream protocol exactly — do not rename JSON tags.
package ilink

// BaseInfo is the metadata blob attached to every CGI request body.
// channel_version is logged server-side; we set it to the value we last
// verified the protocol against.
type BaseInfo struct {
	ChannelVersion string `json:"channel_version,omitempty"`
}

// MessageType values for WeixinMessage.message_type.
const (
	MessageTypeNone = 0
	MessageTypeUser = 1
	MessageTypeBot  = 2
)

// MessageItemType values for MessageItem.type.
const (
	MessageItemTypeNone  = 0
	MessageItemTypeText  = 1
	MessageItemTypeImage = 2
	MessageItemTypeVoice = 3
	MessageItemTypeFile  = 4
	MessageItemTypeVideo = 5
)

// MessageState values for WeixinMessage.message_state.
const (
	MessageStateNew        = 0
	MessageStateGenerating = 1
	MessageStateFinish     = 2
)

// TextItem carries plain text content.
type TextItem struct {
	Text string `json:"text,omitempty"`
}

// CDNMedia is the encrypted CDN reference embedded in image/voice/file/video
// items. Out of scope for M1 send/receive but kept here so the message
// envelope round-trips losslessly.
type CDNMedia struct {
	EncryptQueryParam string `json:"encrypt_query_param,omitempty"`
	AESKey            string `json:"aes_key,omitempty"`
	EncryptType       int    `json:"encrypt_type,omitempty"`
	FullURL           string `json:"full_url,omitempty"`
}

// VoiceItem carries voice messages. The Text field is server-side STT and
// is the only field we read in M1 (for inbound voice → text fallback).
type VoiceItem struct {
	Media         *CDNMedia `json:"media,omitempty"`
	EncodeType    int       `json:"encode_type,omitempty"`
	BitsPerSample int       `json:"bits_per_sample,omitempty"`
	SampleRate    int       `json:"sample_rate,omitempty"`
	PlayTime      int       `json:"playtime,omitempty"`
	Text          string    `json:"text,omitempty"`
}

// ImageItem, FileItem, VideoItem — declared so the JSON unmarshal does not
// drop the fields. Bodies omitted; we do not interact with media in M1.
type ImageItem struct {
	Media       *CDNMedia `json:"media,omitempty"`
	ThumbMedia  *CDNMedia `json:"thumb_media,omitempty"`
	AESKey      string    `json:"aeskey,omitempty"`
	URL         string    `json:"url,omitempty"`
	MidSize     int       `json:"mid_size,omitempty"`
	ThumbSize   int       `json:"thumb_size,omitempty"`
	ThumbHeight int       `json:"thumb_height,omitempty"`
	ThumbWidth  int       `json:"thumb_width,omitempty"`
	HDSize      int       `json:"hd_size,omitempty"`
}

type FileItem struct {
	Media    *CDNMedia `json:"media,omitempty"`
	FileName string    `json:"file_name,omitempty"`
	MD5      string    `json:"md5,omitempty"`
	Len      string    `json:"len,omitempty"`
}

type VideoItem struct {
	Media       *CDNMedia `json:"media,omitempty"`
	VideoSize   int       `json:"video_size,omitempty"`
	PlayLength  int       `json:"play_length,omitempty"`
	VideoMD5    string    `json:"video_md5,omitempty"`
	ThumbMedia  *CDNMedia `json:"thumb_media,omitempty"`
	ThumbSize   int       `json:"thumb_size,omitempty"`
	ThumbHeight int       `json:"thumb_height,omitempty"`
	ThumbWidth  int       `json:"thumb_width,omitempty"`
}

// RefMessage is a quoted message reference. Used for inbound parsing of
// "@reply" style messages.
type RefMessage struct {
	MessageItem *MessageItem `json:"message_item,omitempty"`
	Title       string       `json:"title,omitempty"`
}

// MessageItem is one element of a WeixinMessage.item_list. Exactly one of
// the *_item fields is populated, selected by Type.
type MessageItem struct {
	Type         int         `json:"type,omitempty"`
	CreateTimeMs int64       `json:"create_time_ms,omitempty"`
	UpdateTimeMs int64       `json:"update_time_ms,omitempty"`
	IsCompleted  bool        `json:"is_completed,omitempty"`
	MsgID        string      `json:"msg_id,omitempty"`
	RefMsg       *RefMessage `json:"ref_msg,omitempty"`
	TextItem     *TextItem   `json:"text_item,omitempty"`
	ImageItem    *ImageItem  `json:"image_item,omitempty"`
	VoiceItem    *VoiceItem  `json:"voice_item,omitempty"`
	FileItem     *FileItem   `json:"file_item,omitempty"`
	VideoItem    *VideoItem  `json:"video_item,omitempty"`
}

// WeixinMessage is the unified message envelope (proto: WeixinMessage).
// Used for both inbound (getupdates) and outbound (sendmessage).
type WeixinMessage struct {
	Seq          int64         `json:"seq,omitempty"`
	MessageID    int64         `json:"message_id,omitempty"`
	FromUserID   string        `json:"from_user_id,omitempty"`
	ToUserID     string        `json:"to_user_id,omitempty"`
	ClientID     string        `json:"client_id,omitempty"`
	CreateTimeMs int64         `json:"create_time_ms,omitempty"`
	UpdateTimeMs int64         `json:"update_time_ms,omitempty"`
	DeleteTimeMs int64         `json:"delete_time_ms,omitempty"`
	SessionID    string        `json:"session_id,omitempty"`
	GroupID      string        `json:"group_id,omitempty"`
	MessageType  int           `json:"message_type,omitempty"`
	MessageState int           `json:"message_state,omitempty"`
	ItemList     []MessageItem `json:"item_list,omitempty"`
	ContextToken string        `json:"context_token,omitempty"`
}

// GetUpdatesReq is the long-poll request body. The cursor is opaque: pass
// what the previous response returned, or "" on the very first call.
type GetUpdatesReq struct {
	GetUpdatesBuf string   `json:"get_updates_buf"`
	BaseInfo      BaseInfo `json:"base_info"`
}

// GetUpdatesResp is the long-poll response.
//
// Errcode -14 means the bot session has timed out and the credentials are
// dead — see ErrSessionTimeout. Other non-zero ret/errcode values are
// surfaced as a generic error by Client.GetUpdates.
type GetUpdatesResp struct {
	Ret                  int             `json:"ret,omitempty"`
	ErrCode              int             `json:"errcode,omitempty"`
	ErrMsg               string          `json:"errmsg,omitempty"`
	Msgs                 []WeixinMessage `json:"msgs,omitempty"`
	GetUpdatesBuf        string          `json:"get_updates_buf,omitempty"`
	LongPollingTimeoutMs int             `json:"longpolling_timeout_ms,omitempty"`
}

// SendMessageReq wraps a single outbound WeixinMessage.
//
// Note: the upstream protocol allows item_list to contain at most one item
// per request. To send text + image, the upstream client makes two separate
// sendmessage calls. We only send text in M1 so this constraint does not
// matter, but it must be respected if media is added later.
type SendMessageReq struct {
	Msg      *WeixinMessage `json:"msg"`
	BaseInfo BaseInfo       `json:"base_info"`
}

// QRCodeResp is the response to GET ilink/bot/get_bot_qrcode.
//
// Qrcode is the opaque token used to poll status. QrcodeImgContent is the
// URL string that must be encoded into a QR image for the user to scan
// with WeChat.
type QRCodeResp struct {
	Qrcode           string `json:"qrcode"`
	QrcodeImgContent string `json:"qrcode_img_content"`
}

// QRStatus values returned by GET ilink/bot/get_qrcode_status.
type QRStatus string

const (
	QRStatusWait              QRStatus = "wait"
	QRStatusScaned            QRStatus = "scaned"
	QRStatusConfirmed         QRStatus = "confirmed"
	QRStatusExpired           QRStatus = "expired"
	QRStatusScanedButRedirect QRStatus = "scaned_but_redirect"
)

// QRStatusResp is the response to the QR status long-poll. The credential
// fields are populated only on QRStatusConfirmed; RedirectHost only on
// QRStatusScanedButRedirect.
type QRStatusResp struct {
	Status       QRStatus `json:"status"`
	BotToken     string   `json:"bot_token,omitempty"`
	ILinkBotID   string   `json:"ilink_bot_id,omitempty"`
	BaseURL      string   `json:"baseurl,omitempty"`
	ILinkUserID  string   `json:"ilink_user_id,omitempty"`
	RedirectHost string   `json:"redirect_host,omitempty"`
}

// =============================================================================
// CDN upload (POST /ilink/bot/getuploadurl)
// =============================================================================

// MediaType values for GetUploadUrlReq.media_type.
//
// CRITICAL: this enum is *different* from MessageItemType. Upstream exposes
// it as `UploadMediaType` in src/api/types.ts:
//
//	IMAGE = 1, VIDEO = 2, FILE = 3, VOICE = 4
//
// MessageItemType (used in sendmessage's `item_list[0].type`) is:
//
//	TEXT = 1, IMAGE = 2, VOICE = 3, FILE = 4, VIDEO = 5
//
// They share NO numeric overlap except IMAGE happens to differ; passing
// MessageItemType into media_type silently mislabels every upload (file
// becomes voice → server rejects, image becomes video → wrong codec
// validation, etc.). Do not collapse the two enums.
const (
	MediaTypeImage = 1
	MediaTypeVideo = 2
	MediaTypeFile  = 3
	MediaTypeVoice = 4
)

// GetUploadUrlReq mirrors src/api/types.ts GetUploadUrlReq. Field names on
// the wire must stay snake_case.
//
//   - rawsize        : plaintext size in bytes
//   - rawfilemd5     : md5(plaintext) lowercase hex
//   - filesize       : ciphertext size after AES-128-ECB + PKCS7 padding
//   - aeskey         : 32-char hex of the 16-byte AES key (legacy field)
//   - no_need_thumb  : upstream sets true for non-image; we set true for all
//     because we don't generate thumbnails (see ADR-0006)
type GetUploadUrlReq struct {
	FileKey         string   `json:"filekey"`
	MediaType       int      `json:"media_type"`
	ToUserID        string   `json:"to_user_id"`
	RawSize         int      `json:"rawsize"`
	RawFileMD5      string   `json:"rawfilemd5"`
	FileSize        int      `json:"filesize"`
	ThumbRawSize    int      `json:"thumb_rawsize,omitempty"`
	ThumbRawFileMD5 string   `json:"thumb_rawfilemd5,omitempty"`
	ThumbFileSize   int      `json:"thumb_filesize,omitempty"`
	NoNeedThumb     bool     `json:"no_need_thumb,omitempty"`
	AESKey          string   `json:"aeskey"`
	BaseInfo        BaseInfo `json:"base_info"`
}

// GetUploadUrlResp is the response from /ilink/bot/getuploadurl.
//
// The server actually emits **two** generations of this shape:
//
//   - Legacy (matches upstream ts source): only `upload_param` — an
//     opaque token the caller has to splice into BuildCDNUploadURL.
//   - Current (observed in production traffic Q2 2026): `upload_full_url`
//     — the fully-constructed CDN URL ready to POST to. `upload_param`
//     is empty in this case.
//
// We support both: prefer UploadFullURL when present, fall back to
// constructing the URL ourselves from UploadParam + filekey.
type GetUploadUrlResp struct {
	Ret                int    `json:"ret,omitempty"`
	ErrCode            int    `json:"errcode,omitempty"`
	ErrMsg             string `json:"errmsg,omitempty"`
	UploadParam        string `json:"upload_param,omitempty"`
	UploadFullURL      string `json:"upload_full_url,omitempty"`
	ThumbUploadParam   string `json:"thumb_upload_param,omitempty"`
	ThumbUploadFullURL string `json:"thumb_upload_full_url,omitempty"`
}

// Credentials is everything needed to talk to the messaging API after a
// successful bind. The four fields below are returned together by a
// confirmed QRStatusResp and must all be persisted as a unit.
type Credentials struct {
	BotToken    string `json:"bot_token"`
	ILinkBotID  string `json:"ilink_bot_id"`
	ILinkUserID string `json:"ilink_user_id"`
	BaseURL     string `json:"base_url"`
}
