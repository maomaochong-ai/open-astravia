package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// apiClient is a minimal hand-rolled Telegram Bot API client. Every method
// is a POST to <base>/bot<token>/<method>; responses share the
// {ok, result, description, error_code} envelope.
type apiClient struct {
	base  string // no trailing slash
	token string
	http  *http.Client
}

func newAPIClient(base, token string) *apiClient {
	return &apiClient{
		base:  strings.TrimRight(base, "/"),
		token: token,
		// The timeout must exceed the getUpdates long-poll window
		// (pollTimeoutSeconds) so healthy idle polls are not cut short.
		http: &http.Client{Timeout: 65 * time.Second},
	}
}

// apiError is an ok=false Bot API response.
type apiError struct {
	Code        int
	Description string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("api error %d: %s", e.Code, e.Description)
}

// isParseError reports whether err is Telegram rejecting parse_mode
// entities — the trigger for the plain-text resend fallback.
func isParseError(err error) bool {
	var ae *apiError
	return errors.As(err, &ae) && strings.Contains(ae.Description, "can't parse entities")
}

// isNotModified reports the "message is not modified" edit response, which
// the transport treats as success.
func isNotModified(err error) bool {
	var ae *apiError
	return errors.As(err, &ae) && strings.Contains(ae.Description, "message is not modified")
}

// call POSTs params as JSON to the named method and unmarshals the result
// into out (which may be nil to discard it).
func (c *apiClient) call(ctx context.Context, method string, params any, out any) error {
	body, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("telegram %s: encode: %w", method, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.methodURL(method), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("telegram %s: %w", method, err)
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, method, out)
}

func (c *apiClient) methodURL(method string) string {
	return c.base + "/bot" + c.token + "/" + method
}

func (c *apiClient) do(req *http.Request, method string, out any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("telegram %s: %w", method, err)
	}
	defer resp.Body.Close()

	var envelope struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
		ErrorCode   int             `json:"error_code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("telegram %s: decode: %w", method, err)
	}
	if !envelope.OK {
		return fmt.Errorf("telegram %s: %w", method, &apiError{Code: envelope.ErrorCode, Description: envelope.Description})
	}
	if out != nil && len(envelope.Result) > 0 {
		if err := json.Unmarshal(envelope.Result, out); err != nil {
			return fmt.Errorf("telegram %s: decode result: %w", method, err)
		}
	}
	return nil
}

// upload POSTs a multipart/form-data request with the file at path in the
// given field, plus chat_id and optional caption. Used by sendPhoto /
// sendDocument.
func (c *apiClient) upload(ctx context.Context, method, chatID, field, path, caption string, out any) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open attachment: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.WriteField("chat_id", chatID); err != nil {
		return fmt.Errorf("encode form: %w", err)
	}
	if caption != "" {
		if err := w.WriteField("caption", caption); err != nil {
			return fmt.Errorf("encode form: %w", err)
		}
	}
	part, err := w.CreateFormFile(field, filepath.Base(path))
	if err != nil {
		return fmt.Errorf("encode form: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return fmt.Errorf("read attachment: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("encode form: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.methodURL(method), &buf)
	if err != nil {
		return fmt.Errorf("telegram %s: %w", method, err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	return c.do(req, method, out)
}

// getMe returns the bot's own identity.
func (c *apiClient) getMe(ctx context.Context) (*tgUser, error) {
	var me tgUser
	if err := c.call(ctx, "getMe", map[string]any{}, &me); err != nil {
		return nil, fmt.Errorf("telegram getMe: %w", err)
	}
	return &me, nil
}

// getUpdates long-polls for new updates starting at offset.
func (c *apiClient) getUpdates(ctx context.Context, offset int64, timeoutSeconds int) ([]update, error) {
	var updates []update
	err := c.call(ctx, "getUpdates", map[string]any{
		"offset":          offset,
		"timeout":         timeoutSeconds,
		"allowed_updates": []string{"message", "callback_query"},
	}, &updates)
	if err != nil {
		return nil, fmt.Errorf("telegram getUpdates: %w", err)
	}
	return updates, nil
}

// downloadFile resolves file_id via getFile then fetches the bytes from the
// file endpoint, capped at maxBytes.
func (c *apiClient) downloadFile(ctx context.Context, fileID string, maxBytes int64) ([]byte, error) {
	var f tgFile
	if err := c.call(ctx, "getFile", map[string]any{"file_id": fileID}, &f); err != nil {
		return nil, fmt.Errorf("telegram getFile: %w", err)
	}
	if f.FilePath == "" {
		return nil, fmt.Errorf("telegram getFile: empty file_path for %s", fileID)
	}
	url := c.base + "/file/bot" + c.token + "/" + f.FilePath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("telegram download: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("telegram download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("telegram download: http %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("telegram download: %w", err)
	}
	if int64(len(b)) > maxBytes {
		return nil, fmt.Errorf("telegram download: file exceeds %d-byte cap", maxBytes)
	}
	return b, nil
}

// =============================================================================
// wire types (inbound subset only — we never marshal these)
// =============================================================================

type update struct {
	UpdateID      int64          `json:"update_id"`
	Message       *tgMessage     `json:"message"`
	CallbackQuery *callbackQuery `json:"callback_query"`
}

type tgMessage struct {
	MessageID      int64       `json:"message_id"`
	From           *tgUser     `json:"from"`
	Chat           tgChat      `json:"chat"`
	Text           string      `json:"text"`
	Caption        string      `json:"caption"`
	ReplyToMessage *tgMessage  `json:"reply_to_message"`
	Photo          []photoSize `json:"photo"`
	Document       *document   `json:"document"`
	Voice          *voice      `json:"voice"`
}

type tgUser struct {
	ID       int64  `json:"id"`
	IsBot    bool   `json:"is_bot"`
	Username string `json:"username"`
}

type tgChat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"` // "private" / "group" / "supergroup" / "channel"
}

type callbackQuery struct {
	ID      string     `json:"id"`
	From    tgUser     `json:"from"`
	Message *tgMessage `json:"message"`
	Data    string     `json:"data"`
}

type photoSize struct {
	FileID string `json:"file_id"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type document struct {
	FileID   string `json:"file_id"`
	FileName string `json:"file_name"`
}

type voice struct {
	FileID string `json:"file_id"`
}

type tgFile struct {
	FileID   string `json:"file_id"`
	FilePath string `json:"file_path"`
}
