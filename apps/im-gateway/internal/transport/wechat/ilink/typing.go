package ilink

import (
	"context"
	"fmt"
)

// GetConfigReq fetches per-peer bot config. We only need typing_ticket, which
// authorizes the sendtyping call. context_token is optional and mirrors the
// send path (omitted ⇒ treated as a proactive context by the server).
type GetConfigReq struct {
	ILinkUserID  string   `json:"ilink_user_id"`
	ContextToken string   `json:"context_token,omitempty"`
	BaseInfo     BaseInfo `json:"base_info"`
}

// GetConfigResp carries the typing_ticket used to authorize sendtyping.
type GetConfigResp struct {
	Ret          int    `json:"ret,omitempty"`
	ErrMsg       string `json:"errmsg,omitempty"`
	TypingTicket string `json:"typing_ticket,omitempty"`
}

// SendTypingReq drives the "对方正在输入" indicator. Status 1=typing, 2=cancel.
type SendTypingReq struct {
	ILinkUserID  string   `json:"ilink_user_id"`
	TypingTicket string   `json:"typing_ticket"`
	Status       int      `json:"status"`
	BaseInfo     BaseInfo `json:"base_info"`
}

const (
	typingStatusTyping = 1
	typingStatusCancel = 2
)

// SendTyping sends one "typing" (or "cancel") pulse to peer. The indicator's
// server-side lifetime is short (~5-8s), so callers re-send on a heartbeat to
// keep it visible while the bot is working. The typing_ticket from getconfig
// is cached per peer and refetched transparently when a send is rejected.
func (c *Client) SendTyping(ctx context.Context, peerUserID, contextToken string, typing bool) error {
	if peerUserID == "" {
		return fmt.Errorf("ilink: SendTyping: peerUserID required")
	}
	baseURL := c.MessagingBaseURL()
	if baseURL == "" || c.botTokenValue() == "" {
		return ErrCredentialsMissing
	}

	ticket, err := c.typingTicket(ctx, peerUserID, contextToken)
	if err != nil {
		return err
	}
	status := typingStatusTyping
	if !typing {
		status = typingStatusCancel
	}
	body := SendTypingReq{
		ILinkUserID:  peerUserID,
		TypingTicket: ticket,
		Status:       status,
		BaseInfo:     c.baseInfo(),
	}
	if err := c.postJSON(ctx, baseURL, "ilink/bot/sendtyping", body, nil, c.apiTimeout, "sendtyping"); err != nil {
		// The ticket may have expired; drop the cache so the next pulse
		// refetches it via getconfig.
		c.invalidateTypingTicket(peerUserID)
		return err
	}
	return nil
}

// typingTicket returns a cached typing_ticket for peer, fetching one via
// getconfig on a cache miss.
func (c *Client) typingTicket(ctx context.Context, peerUserID, contextToken string) (string, error) {
	c.typingMu.Lock()
	if t := c.typingTickets[peerUserID]; t != "" {
		c.typingMu.Unlock()
		return t, nil
	}
	c.typingMu.Unlock()

	var resp GetConfigResp
	if err := c.postJSON(ctx, c.MessagingBaseURL(), "ilink/bot/getconfig", GetConfigReq{
		ILinkUserID:  peerUserID,
		ContextToken: contextToken,
		BaseInfo:     c.baseInfo(),
	}, &resp, c.apiTimeout, "getconfig"); err != nil {
		return "", err
	}
	if resp.TypingTicket == "" {
		return "", fmt.Errorf("ilink: getconfig: empty typing_ticket (ret=%d %s)", resp.Ret, resp.ErrMsg)
	}

	c.typingMu.Lock()
	if c.typingTickets == nil {
		c.typingTickets = make(map[string]string)
	}
	c.typingTickets[peerUserID] = resp.TypingTicket
	c.typingMu.Unlock()
	return resp.TypingTicket, nil
}

func (c *Client) invalidateTypingTicket(peerUserID string) {
	c.typingMu.Lock()
	delete(c.typingTickets, peerUserID)
	c.typingMu.Unlock()
}
