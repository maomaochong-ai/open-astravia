package main

import (
	"errors"
	"strings"
	"testing"

	"vetta-im-gateway/internal/hostproto"
)

// TestSpecFromInit_AllSlots pins the InitFrame → buildSpec mapping so a new
// channel slot cannot be added to the protocol without being carried here.
func TestSpecFromInit_AllSlots(t *testing.T) {
	init := &hostproto.InitFrame{
		Type:            hostproto.TypeInit,
		ConversationCwd: "/tmp/conv",
		Feishu:          &hostproto.FeishuConfig{AppID: "cli_x", AppSecret: "s"},
		Wechat:          &hostproto.WechatConfig{Enabled: true, StatePath: "/tmp/wechat.json"},
		Telegram:        &hostproto.TelegramConfig{BotToken: "t"},
		Slack:           &hostproto.SlackConfig{BotToken: "xoxb-a", AppToken: "xapp-b"},
		Discord:         &hostproto.DiscordConfig{BotToken: "d"},
		Signal:          &hostproto.SignalConfig{Endpoint: "http://127.0.0.1:8080", Account: "+1"},
		Whatsapp:        &hostproto.WhatsappConfig{Enabled: true, StatePath: "/tmp/wa.db"},
		IMessage:        &hostproto.IMessageConfig{Enabled: true, DBPath: "/tmp/chat.db"},
	}

	spec := specFromInit(init)

	if spec.ConversationCwd != "/tmp/conv" {
		t.Fatalf("ConversationCwd = %q", spec.ConversationCwd)
	}
	if spec.WechatStatePath != "/tmp/wechat.json" {
		t.Fatalf("WechatStatePath = %q", spec.WechatStatePath)
	}
	if spec.WhatsappStatePath != "/tmp/wa.db" {
		t.Fatalf("WhatsappStatePath = %q", spec.WhatsappStatePath)
	}
	for name, present := range map[string]bool{
		"feishu":   spec.Feishu != nil,
		"wechat":   spec.Wechat != nil,
		"telegram": spec.Telegram != nil,
		"slack":    spec.Slack != nil,
		"discord":  spec.Discord != nil,
		"signal":   spec.Signal != nil,
		"whatsapp": spec.Whatsapp != nil,
		"imessage": spec.IMessage != nil,
	} {
		if !present {
			t.Errorf("slot %s not carried into buildSpec", name)
		}
	}
}

func TestSpecFromConfigUpdate_CarriesSlotsAndStatePaths(t *testing.T) {
	spec := specFromConfigUpdate(&hostproto.ConfigUpdateFrame{
		Type:     hostproto.TypeConfigUpdate,
		Telegram: &hostproto.TelegramConfig{BotToken: "t", AllowedUserIDs: []int64{7}},
		Whatsapp: &hostproto.WhatsappConfig{Enabled: true, StatePath: "/tmp/wa.db"},
	})
	if spec.Telegram == nil || len(spec.Telegram.AllowedUserIDs) != 1 {
		t.Fatalf("telegram slot lost: %+v", spec.Telegram)
	}
	if spec.WhatsappStatePath != "/tmp/wa.db" {
		t.Fatalf("WhatsappStatePath = %q", spec.WhatsappStatePath)
	}
}

func TestBuildSpec_HasChannel(t *testing.T) {
	if (&buildSpec{}).hasChannel() {
		t.Fatal("empty spec reported a channel")
	}
	cases := []*buildSpec{
		{Feishu: &hostproto.FeishuConfig{}},
		{Wechat: &hostproto.WechatConfig{}},
		{Telegram: &hostproto.TelegramConfig{}},
		{Slack: &hostproto.SlackConfig{}},
		{Discord: &hostproto.DiscordConfig{}},
		{Signal: &hostproto.SignalConfig{}},
		{Whatsapp: &hostproto.WhatsappConfig{}},
		{IMessage: &hostproto.IMessageConfig{}},
	}
	for i, s := range cases {
		if !s.hasChannel() {
			t.Errorf("case %d: hasChannel() = false", i)
		}
	}
}

// TestBuildHostTransport_SelectsPerSlot builds each statically-credentialed
// channel and asserts the transport identifies itself as that platform.
// Constructors here must not perform any network I/O.
func TestBuildHostTransport_SelectsPerSlot(t *testing.T) {
	cases := []struct {
		name string
		spec *buildSpec
	}{
		{"feishu", &buildSpec{Feishu: &hostproto.FeishuConfig{AppID: "cli_x", AppSecret: "s"}}},
		{"telegram", &buildSpec{Telegram: &hostproto.TelegramConfig{BotToken: "123:abc"}}},
		{"slack", &buildSpec{Slack: &hostproto.SlackConfig{BotToken: "xoxb-a", AppToken: "xapp-b"}}},
		{"discord", &buildSpec{Discord: &hostproto.DiscordConfig{BotToken: "d"}}},
		{"signal", &buildSpec{Signal: &hostproto.SignalConfig{Endpoint: "http://127.0.0.1:8080", Account: "+15551234567"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tr, err := buildHostTransport(tc.spec)
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			if tr.Name() != tc.name {
				t.Fatalf("Name() = %q, want %q", tr.Name(), tc.name)
			}
			_ = tr.Stop()
		})
	}
}

// Feishu credentials can also be minted by the one-click scan flow, so an
// empty slot parks the sidecar in awaiting_bind instead of failing.
func TestBuildHostTransport_FeishuWithoutCredentialsAwaitsBind(t *testing.T) {
	_, err := buildHostTransport(&buildSpec{Feishu: &hostproto.FeishuConfig{}})
	if !errors.Is(err, errAwaitingBind) {
		t.Fatalf("err = %v, want errAwaitingBind", err)
	}
}

func TestBuildHostTransport_MissingCredentials(t *testing.T) {
	cases := []struct {
		name string
		spec *buildSpec
		want string
	}{
		{"telegram", &buildSpec{Telegram: &hostproto.TelegramConfig{}}, "botToken"},
		{"slack", &buildSpec{Slack: &hostproto.SlackConfig{BotToken: "xoxb-a"}}, "appToken"},
		{"discord", &buildSpec{Discord: &hostproto.DiscordConfig{}}, "botToken"},
		{"signal", &buildSpec{Signal: &hostproto.SignalConfig{Endpoint: "http://x"}}, "account"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := buildHostTransport(tc.spec)
			if err == nil {
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q does not mention %q", err, tc.want)
			}
		})
	}
}

func TestBuildHostTransport_NoSelection(t *testing.T) {
	if _, err := buildHostTransport(&buildSpec{}); err == nil {
		t.Fatal("expected an error for a spec with no channel")
	}
	if _, err := buildHostTransport(nil); err == nil {
		t.Fatal("expected an error for a nil spec")
	}
}

// TestBuildHostTransport_DisabledPairingSlotsAreNotSelected guards the
// Enabled flag on the pairing / local-permission channels: a slot present
// but disabled must fall through to the next candidate rather than being
// built.
func TestBuildHostTransport_DisabledPairingSlotsAreNotSelected(t *testing.T) {
	spec := &buildSpec{
		Wechat:   &hostproto.WechatConfig{Enabled: false},
		IMessage: &hostproto.IMessageConfig{Enabled: false},
		Telegram: &hostproto.TelegramConfig{BotToken: "123:abc"},
	}
	tr, err := buildHostTransport(spec)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	defer func() { _ = tr.Stop() }()
	if tr.Name() != "telegram" {
		t.Fatalf("Name() = %q, want telegram", tr.Name())
	}
}
