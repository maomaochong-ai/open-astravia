package main

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"vetta-im-gateway/internal/hostproto"
	signalcli "vetta-im-gateway/internal/transport/signal"
)

func TestBindCoordinatorKind(t *testing.T) {
	cases := []struct {
		name string
		spec *buildSpec
		want string
	}{
		{"nil spec", nil, ""},
		{"wechat enabled", &buildSpec{Wechat: &hostproto.WechatConfig{Enabled: true}}, "wechat"},
		{"wechat disabled", &buildSpec{Wechat: &hostproto.WechatConfig{}}, ""},
		{"signal managed", &buildSpec{Signal: &hostproto.SignalConfig{}}, "signal"},
		{
			"signal user-managed daemon",
			&buildSpec{Signal: &hostproto.SignalConfig{Endpoint: "http://127.0.0.1:8080", Account: "+1"}},
			"",
		},
		{"no pairing channel", &buildSpec{Telegram: &hostproto.TelegramConfig{BotToken: "t"}}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := bindCoordinatorKind(tc.spec); got != tc.want {
				t.Fatalf("kind = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestBindFrames_RoutedToActiveChannelOnly guards the failure mode the
// coordKind check exists for: a stale wechat frame must not drive a signal
// link flow, and vice versa.
func TestBindFrames_RoutedToActiveChannelOnly(t *testing.T) {
	cases := []struct {
		name      string
		coordKind string
		frame     any
		want      frameAction
	}{
		{"signal frame on signal", "signal", &hostproto.SignalBindStartFrame{}, frameAction{startBind: true}},
		{"signal logout on signal", "signal", &hostproto.SignalLogoutFrame{}, frameAction{logout: true}},
		{"wechat frame on signal", "signal", &hostproto.WechatBindStartFrame{}, frameAction{}},
		{"signal frame on wechat", "wechat", &hostproto.SignalBindStartFrame{}, frameAction{}},
		{"wechat frame on wechat", "wechat", &hostproto.WechatBindStartFrame{}, frameAction{startBind: true}},
		{"signal frame with no coordinator", "", &hostproto.SignalBindStartFrame{}, frameAction{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := &hostRuntime{
				out:     hostproto.NewWriter(io.Discard),
				emitLog: func(string, string, map[string]any) {},
			}
			if tc.coordKind != "" {
				h.coordKind = tc.coordKind
				h.coord = &stubBindCoordinator{}
			}
			if got := h.handleFrame(tc.frame); got != tc.want {
				t.Fatalf("action = %+v, want %+v", got, tc.want)
			}
		})
	}
}

// TestConfigUpdate_SwapsCoordinator pins the coordinator lifecycle across a
// channel switch: the outgoing one is cancelled, the incoming one matches
// the new selection.
func TestConfigUpdate_SwapsCoordinator(t *testing.T) {
	old := &stubBindCoordinator{}
	h := &hostRuntime{
		out:       hostproto.NewWriter(io.Discard),
		emitLog:   func(string, string, map[string]any) {},
		coord:     old,
		coordKind: "wechat",
		spec:      &buildSpec{Wechat: &hostproto.WechatConfig{Enabled: true}},
	}

	action := h.handleFrame(&hostproto.ConfigUpdateFrame{
		Type:   hostproto.TypeConfigUpdate,
		Signal: &hostproto.SignalConfig{ConfigDir: "/tmp/signal-cli"},
	})

	if !action.rebuild {
		t.Fatal("config_update should request a rebuild")
	}
	if !old.cancelled {
		t.Fatal("previous coordinator was not cancelled")
	}
	if h.coordKind != "signal" {
		t.Fatalf("coordKind = %q, want signal", h.coordKind)
	}
	if _, ok := h.coord.(*signalBindCoordinator); !ok {
		t.Fatalf("coord = %T, want *signalBindCoordinator", h.coord)
	}
}

// TestResolveSignalAccount_ConfiguredWins keeps the CLI out of the picture
// when the parent already knows the account.
func TestResolveSignalAccount_ConfiguredWins(t *testing.T) {
	got, err := resolveSignalAccount(&hostproto.SignalConfig{Account: "+8613800000000"})
	if err != nil {
		t.Fatalf("resolveSignalAccount: %v", err)
	}
	if got != "+8613800000000" {
		t.Fatalf("account = %q", got)
	}
}

// TestResolveSignalAccount_UserManagedNeedsAccount: pointing at someone
// else's daemon gives us no way to discover the number, so it must be an
// explicit error rather than a silent awaiting_bind.
func TestResolveSignalAccount_UserManagedNeedsAccount(t *testing.T) {
	_, err := resolveSignalAccount(&hostproto.SignalConfig{Endpoint: "http://127.0.0.1:8080"})
	if err == nil || !strings.Contains(err.Error(), "account") {
		t.Fatalf("err = %v, want a missing-account error", err)
	}
}

// TestResolveSignalAccount_CLIMissingMentionsInstall makes sure the user
// gets the install command instead of a bare "not found".
func TestResolveSignalAccount_CLIMissingMentionsInstall(t *testing.T) {
	_, err := resolveSignalAccount(&hostproto.SignalConfig{
		CLIPath: "/definitely/not/a/signal-cli",
	})
	if !errors.Is(err, signalcli.ErrCLINotFound) {
		t.Fatalf("err = %v, want ErrCLINotFound", err)
	}
	if !strings.Contains(err.Error(), signalcli.InstallHint()) {
		t.Fatalf("err = %v, want it to carry the install hint", err)
	}
}

type stubBindCoordinator struct {
	started   bool
	cancelled bool
	loggedOut bool
	adopted   *buildSpec
}

func (s *stubBindCoordinator) Start(context.Context) { s.started = true }
func (s *stubBindCoordinator) Adopt(spec *buildSpec) { s.adopted = spec }
func (s *stubBindCoordinator) Cancel()               { s.cancelled = true }
func (s *stubBindCoordinator) LogoutAndClear(string) error {
	s.loggedOut = true
	return nil
}
