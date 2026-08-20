package whatsapp

import (
	"fmt"
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

const (
	selfUser  = "8613800000000"
	peerUser  = "8613911111111"
	otherUser = "8613922222222"
	groupUser = "123456789-987654"
)

// testTransport builds a Transport with just the fields normalizeMessage
// reads, bypassing New so no sqlite store is needed.
func testTransport(allowed ...string) *Transport {
	return &Transport{
		selfUser: selfUser,
		selfLID:  "111222333444555",
		allowed:  normalizeAllowedNumbers(allowed),
		quotes:   make(map[string]string),
	}
}

func dmEvent(text string) *events.Message {
	sender := types.NewJID(peerUser, types.DefaultUserServer)
	return &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{Chat: sender, Sender: sender},
			ID:            "MSG1",
			Timestamp:     time.Unix(1700000000, 0),
		},
		Message: &waE2E.Message{Conversation: ptrString(text)},
	}
}

func groupEvent(text string, mentioned ...string) *events.Message {
	ext := &waE2E.ExtendedTextMessage{Text: ptrString(text)}
	if len(mentioned) > 0 {
		ext.ContextInfo = &waE2E.ContextInfo{MentionedJID: mentioned}
	}
	return &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat:    types.NewJID(groupUser, types.GroupServer),
				Sender:  types.NewJID(peerUser, types.DefaultUserServer),
				IsGroup: true,
			},
			ID:        "GMSG1",
			Timestamp: time.Unix(1700000000, 0),
		},
		Message: &waE2E.Message{ExtendedTextMessage: ext},
	}
}

func TestNormalizePrivateText(t *testing.T) {
	tr := testTransport()
	msg, ok := tr.normalizeMessage(dmEvent("hello"))
	if !ok {
		t.Fatal("expected delivery")
	}
	if msg.Platform != "whatsapp" {
		t.Errorf("Platform = %q", msg.Platform)
	}
	if want := peerUser + "@s.whatsapp.net"; msg.ChatID != want {
		t.Errorf("ChatID = %q, want %q", msg.ChatID, want)
	}
	if msg.UserID != msg.ChatID {
		t.Errorf("UserID = %q, want %q", msg.UserID, msg.ChatID)
	}
	if msg.MessageID != "MSG1" {
		t.Errorf("MessageID = %q", msg.MessageID)
	}
	if msg.Text != "hello" {
		t.Errorf("Text = %q", msg.Text)
	}
	if msg.ReplyToID != "" {
		t.Errorf("ReplyToID = %q, want empty", msg.ReplyToID)
	}
}

func TestNormalizeIgnoresFromMe(t *testing.T) {
	tr := testTransport()
	evt := dmEvent("self echo")
	evt.Info.IsFromMe = true
	if _, ok := tr.normalizeMessage(evt); ok {
		t.Fatal("IsFromMe message must be dropped")
	}
}

func TestNormalizeAllowlist(t *testing.T) {
	tr := testTransport("+86 139-1111-1111")
	if _, ok := tr.normalizeMessage(dmEvent("in list")); !ok {
		t.Fatal("allowlisted sender must be delivered")
	}

	evt := dmEvent("not in list")
	other := types.NewJID(otherUser, types.DefaultUserServer)
	evt.Info.Chat = other
	evt.Info.Sender = other
	if _, ok := tr.normalizeMessage(evt); ok {
		t.Fatal("non-allowlisted sender must be dropped")
	}
}

func TestNormalizeAllowlistMatchesSenderAlt(t *testing.T) {
	tr := testTransport("+8613911111111")
	evt := dmEvent("via lid")
	lid := types.NewJID("999888777", types.HiddenUserServer)
	evt.Info.Chat = lid
	evt.Info.Sender = lid
	evt.Info.SenderAlt = types.NewJID(peerUser, types.DefaultUserServer)
	if _, ok := tr.normalizeMessage(evt); !ok {
		t.Fatal("sender matching via SenderAlt must be delivered")
	}
}

func TestNormalizeGroupRequiresMention(t *testing.T) {
	tr := testTransport()
	if _, ok := tr.normalizeMessage(groupEvent("no mention here")); ok {
		t.Fatal("group message without mention must be dropped")
	}
	if _, ok := tr.normalizeMessage(groupEvent("@"+otherUser+" hi", otherUser+"@s.whatsapp.net")); ok {
		t.Fatal("group message mentioning someone else must be dropped")
	}
}

func TestNormalizeGroupMentionStripped(t *testing.T) {
	tr := testTransport()
	evt := groupEvent("@"+selfUser+" do the thing", selfUser+"@s.whatsapp.net")
	msg, ok := tr.normalizeMessage(evt)
	if !ok {
		t.Fatal("mentioned group message must be delivered")
	}
	if msg.Text != "do the thing" {
		t.Errorf("Text = %q, want mention stripped", msg.Text)
	}
	if want := groupUser + "@g.us"; msg.ChatID != want {
		t.Errorf("ChatID = %q, want %q", msg.ChatID, want)
	}
	if want := peerUser + "@s.whatsapp.net"; msg.UserID != want {
		t.Errorf("UserID = %q, want %q", msg.UserID, want)
	}
}

func TestNormalizeGroupMentionByLID(t *testing.T) {
	tr := testTransport()
	evt := groupEvent("@111222333444555 ping", "111222333444555@lid")
	msg, ok := tr.normalizeMessage(evt)
	if !ok {
		t.Fatal("LID mention must be delivered")
	}
	if msg.Text != "ping" {
		t.Errorf("Text = %q", msg.Text)
	}
}

func TestNormalizeQuoteBecomesReplyTo(t *testing.T) {
	tr := testTransport()
	evt := dmEvent("")
	evt.Message = &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text: ptrString("replying"),
		ContextInfo: &waE2E.ContextInfo{
			StanzaID:    ptrString("ORIG42"),
			Participant: ptrString(selfUser + "@s.whatsapp.net"),
		},
	}}
	msg, ok := tr.normalizeMessage(evt)
	if !ok {
		t.Fatal("expected delivery")
	}
	if msg.ReplyToID != "ORIG42" {
		t.Errorf("ReplyToID = %q, want ORIG42", msg.ReplyToID)
	}
	if msg.Text != "replying" {
		t.Errorf("Text = %q", msg.Text)
	}
}

func TestNormalizeMediaCaption(t *testing.T) {
	tr := testTransport()
	evt := dmEvent("")
	evt.Message = &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
		Caption:  ptrString("look at this"),
		Mimetype: ptrString("image/jpeg"),
	}}
	msg, ok := tr.normalizeMessage(evt)
	if !ok {
		t.Fatal("media message must survive normalization")
	}
	if msg.Text != "look at this" {
		t.Errorf("Text = %q", msg.Text)
	}
	if len(mediaParts(evt.Message)) != 1 {
		t.Errorf("expected one media part")
	}
}

func TestNormalizeDropsEmpty(t *testing.T) {
	tr := testTransport()
	evt := dmEvent("")
	if _, ok := tr.normalizeMessage(evt); ok {
		t.Fatal("empty text without media must be dropped")
	}
	evt.Message = &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{}}
	if _, ok := tr.normalizeMessage(evt); ok {
		t.Fatal("protocol message must be dropped")
	}
}

func TestMediaPartsKinds(t *testing.T) {
	doc := &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
		FileName: ptrString("report.pdf"),
		Mimetype: ptrString("application/pdf"),
	}}
	parts := mediaParts(doc)
	if len(parts) != 1 || parts[0].name != "report.pdf" {
		t.Fatalf("document part = %+v", parts)
	}
	if got := mediaParts(&waE2E.Message{Conversation: ptrString("x")}); got != nil {
		t.Fatalf("text message must have no media parts, got %+v", got)
	}
	audio := &waE2E.Message{AudioMessage: &waE2E.AudioMessage{Mimetype: ptrString("audio/ogg; codecs=opus")}}
	if parts := mediaParts(audio); len(parts) != 1 {
		t.Fatalf("audio part missing")
	}
}

func TestNumberHelpers(t *testing.T) {
	cases := []struct{ in, want string }{
		{"+8613800138000", "8613800138000"},
		{"+86 138-0013-8000", "8613800138000"},
		{"", ""},
		{"abc", ""},
	}
	for _, tc := range cases {
		if got := digitsOnly(tc.in); got != tc.want {
			t.Errorf("digitsOnly(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
	if got := numberToJID("+86 139"); got != "86139@s.whatsapp.net" {
		t.Errorf("numberToJID = %q", got)
	}
	m := normalizeAllowedNumbers([]string{"+8613800138000", "", "   "})
	if len(m) != 1 {
		t.Errorf("normalizeAllowedNumbers kept %d entries, want 1", len(m))
	}
}

func TestParseChatJID(t *testing.T) {
	jid, err := parseChatJID(peerUser + "@s.whatsapp.net")
	if err != nil || jid.User != peerUser || jid.Server != types.DefaultUserServer {
		t.Fatalf("parseChatJID user chat: %v %v", jid, err)
	}
	jid, err = parseChatJID(groupUser + "@g.us")
	if err != nil || jid.Server != types.GroupServer {
		t.Fatalf("parseChatJID group chat: %v %v", jid, err)
	}
	if _, err := parseChatJID(""); err == nil {
		t.Fatal("empty chatID must error")
	}
	// Bare number tolerated.
	jid, err = parseChatJID("+8613800138000")
	if err != nil || jid.User != "8613800138000" {
		t.Fatalf("parseChatJID bare number: %v %v", jid, err)
	}
}

func TestQuoteRegistryBounded(t *testing.T) {
	tr := testTransport()
	for i := 0; i < quoteRegistryCap+10; i++ {
		tr.rememberQuote(fmt.Sprintf("MSG-%d", i), "sender@s.whatsapp.net")
	}
	if len(tr.quotes) > quoteRegistryCap {
		t.Fatalf("quote registry grew to %d, cap %d", len(tr.quotes), quoteRegistryCap)
	}
	if _, ok := tr.lookupQuote(fmt.Sprintf("MSG-%d", quoteRegistryCap+9)); !ok {
		t.Fatal("newest entry must survive eviction")
	}
}
