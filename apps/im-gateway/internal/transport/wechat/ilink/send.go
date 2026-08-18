package ilink

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// SendTextOptions describes one text send.
//
// ContextToken is the token captured from the most recent inbound message
// from this peer; passing it makes the call a "reply" rather than a
// "proactive push" and exempts it from the proactive-push quota path. Pass
// "" only when intentionally pushing without an inbound trigger.
type SendTextOptions struct {
	PeerUserID   string
	Text         string
	ContextToken string
}

// SendText sends a single text message. Returns the client_id we generated
// (used as the message ID by upper layers — the upstream protocol uses
// client_id as the primary key for outbound, and there is no separate
// server-assigned id in the response).
func (c *Client) SendText(ctx context.Context, opts SendTextOptions) (clientID string, err error) {
	if opts.PeerUserID == "" {
		return "", fmt.Errorf("ilink: SendText: PeerUserID required")
	}
	baseURL := c.MessagingBaseURL()
	if baseURL == "" || c.botTokenValue() == "" {
		return "", ErrCredentialsMissing
	}

	cid, err := generateClientID()
	if err != nil {
		return "", fmt.Errorf("ilink: generate client_id: %w", err)
	}

	msg := &WeixinMessage{
		FromUserID:   "",
		ToUserID:     opts.PeerUserID,
		ClientID:     cid,
		MessageType:  MessageTypeBot,
		MessageState: MessageStateFinish,
	}
	if opts.Text != "" {
		msg.ItemList = []MessageItem{{
			Type:     MessageItemTypeText,
			TextItem: &TextItem{Text: opts.Text},
		}}
	}
	if opts.ContextToken != "" {
		msg.ContextToken = opts.ContextToken
	}

	body := SendMessageReq{
		Msg:      msg,
		BaseInfo: c.baseInfo(),
	}

	if err := c.postJSON(ctx, baseURL, "ilink/bot/sendmessage", body, nil, c.apiTimeout, "sendmessage"); err != nil {
		return "", err
	}
	return cid, nil
}

// generateClientID produces a unique-enough client_id for outbound
// messages. Upstream uses a "<channel>-<base36-time>-<base36-rand>" format;
// for our purposes a hex random suffix prefixed with the channel name is
// sufficient and avoids parser ambiguity.
func generateClientID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "vetta-wechat-" + hex.EncodeToString(b[:]), nil
}
