package whatsapp

import (
	"errors"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"vetta-im-gateway/internal/transport"
)

var errChatIDRequired = errors.New("whatsapp: chatID required")

// normalizeMessage translates an events.Message into the gateway's
// InboundMessage. Returns ok=false when the event must be dropped:
//   - sent by ourselves (IsFromMe)
//   - group message that does not @-mention us
//   - private chat sender not on the allowlist
//   - no text and no downloadable media
//
// Media download is NOT done here (see handleMessage) so this stays directly
// testable with hand-built events; ok=true with empty Text means "media-only,
// resolve attachments before forwarding". Depends only on t.selfUser /
// t.selfLID / t.allowed, injected at Start (or directly in tests).
func (t *Transport) normalizeMessage(evt *events.Message) (*transport.InboundMessage, bool) {
	if evt == nil || evt.Message == nil {
		return nil, false
	}
	if evt.Info.IsFromMe {
		return nil, false
	}

	text, ctxInfo := extractTextAndContext(evt.Message)

	if evt.Info.IsGroup {
		if !mentionsUser(ctxInfo, t.selfUser, t.selfLID) {
			return nil, false
		}
		text = stripMentions(text, t.selfUser, t.selfLID)
	} else if !t.senderAllowed(evt.Info) {
		return nil, false
	}

	if text == "" && len(mediaParts(evt.Message)) == 0 {
		return nil, false
	}

	return &transport.InboundMessage{
		Platform:   "whatsapp",
		ChatID:     evt.Info.Chat.ToNonAD().String(),
		UserID:     evt.Info.Sender.ToNonAD().String(),
		MessageID:  evt.Info.ID,
		ReplyToID:  ctxInfo.GetStanzaID(),
		Text:       text,
		ReceivedAt: evt.Info.Timestamp,
		Raw:        evt,
	}, true
}

// senderAllowed applies the private-chat allowlist. Both the sender's primary
// address and its alternative (PN vs LID) are checked so the filter keeps
// working regardless of the chat's addressing mode.
func (t *Transport) senderAllowed(info types.MessageInfo) bool {
	if len(t.allowed) == 0 {
		return true
	}
	if _, ok := t.allowed[info.Sender.User]; ok {
		return true
	}
	if _, ok := t.allowed[info.SenderAlt.User]; ok {
		return true
	}
	return false
}

// extractTextAndContext pulls the user-visible text and the quote/mention
// ContextInfo out of the supported message shapes. Media captions count as
// text.
func extractTextAndContext(msg *waE2E.Message) (string, *waE2E.ContextInfo) {
	switch {
	case msg.GetConversation() != "":
		return msg.GetConversation(), nil
	case msg.GetExtendedTextMessage() != nil:
		ext := msg.GetExtendedTextMessage()
		return ext.GetText(), ext.GetContextInfo()
	case msg.GetImageMessage() != nil:
		m := msg.GetImageMessage()
		return m.GetCaption(), m.GetContextInfo()
	case msg.GetDocumentMessage() != nil:
		m := msg.GetDocumentMessage()
		return m.GetCaption(), m.GetContextInfo()
	case msg.GetVideoMessage() != nil:
		m := msg.GetVideoMessage()
		return m.GetCaption(), m.GetContextInfo()
	case msg.GetAudioMessage() != nil:
		return "", msg.GetAudioMessage().GetContextInfo()
	}
	return "", nil
}

// mentionsUser reports whether ContextInfo.MentionedJID contains any of the
// given JID user parts (empty users are skipped).
func mentionsUser(ctxInfo *waE2E.ContextInfo, users ...string) bool {
	if ctxInfo == nil {
		return false
	}
	for _, raw := range ctxInfo.GetMentionedJID() {
		jid, err := types.ParseJID(raw)
		if err != nil {
			continue
		}
		for _, u := range users {
			if u != "" && jid.User == u {
				return true
			}
		}
	}
	return false
}

// stripMentions removes the literal "@<user>" tokens for the given users
// from text (WhatsApp renders mentions inline as "@<number>").
func stripMentions(text string, users ...string) string {
	for _, u := range users {
		if u != "" {
			text = strings.ReplaceAll(text, "@"+u, "")
		}
	}
	return strings.TrimSpace(text)
}

// normalizeAllowedNumbers converts E.164-ish inputs ("+86 138-0013-8000")
// into the digits-only form JID user parts use. Empty entries are dropped;
// an empty result map means "allow all".
func normalizeAllowedNumbers(numbers []string) map[string]struct{} {
	out := make(map[string]struct{}, len(numbers))
	for _, n := range numbers {
		if d := digitsOnly(n); d != "" {
			out[d] = struct{}{}
		}
	}
	return out
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// numberToJID converts an E.164 number into its WhatsApp user JID string.
func numberToJID(number string) string {
	return digitsOnly(number) + "@" + types.DefaultUserServer
}

// parseChatJID parses a chatID produced by normalizeMessage back into a JID.
// A bare number (no "@") is treated as a user JID for robustness.
func parseChatJID(chatID string) (types.JID, error) {
	if chatID == "" {
		return types.EmptyJID, errChatIDRequired
	}
	if !strings.ContainsRune(chatID, '@') {
		chatID = numberToJID(chatID)
	}
	jid, err := types.ParseJID(chatID)
	if err != nil {
		return types.EmptyJID, err
	}
	if jid.User == "" {
		return types.EmptyJID, errChatIDRequired
	}
	return jid, nil
}
