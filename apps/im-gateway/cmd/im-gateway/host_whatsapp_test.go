package main

import (
	"context"
	"testing"

	"astravia-im-gateway/internal/hostproto"
)

// stubCoordinator records what the host runtime asked it to do. The runtime
// only ever sees bindCoordinator, so a stub is enough to pin the frame → action
// routing without opening any real transport (which would dial WhatsApp).
type stubCoordinator struct {
	started int
	logouts []string
}

func (s *stubCoordinator) Start(context.Context) { s.started++ }
func (s *stubCoordinator) Cancel()               {}
func (s *stubCoordinator) Adopt(*buildSpec)      {}
func (s *stubCoordinator) LogoutAndClear(reason string) error {
	s.logouts = append(s.logouts, reason)
	return nil
}

// whatsapp_bind_start must be routed to a coordinator whose kind is whatsapp.
// Before this wiring existed the frame fell through to "unknown frame", so the
// desktop waited for a QR code that could never arrive.
func TestHandleFrame_RoutesWhatsappBindStart(t *testing.T) {
	coord := &stubCoordinator{}
	h := &hostRuntime{coord: coord, coordKind: "whatsapp", emitLog: func(string, string, map[string]any) {}}

	action := h.handleFrame(&hostproto.WhatsappBindStartFrame{Type: hostproto.TypeWhatsappBindStart})
	if !action.startBind {
		t.Fatal("whatsapp_bind_start did not set startBind")
	}
	if action.logout || action.rebuild || action.stop {
		t.Fatalf("whatsapp_bind_start set unexpected flags: %+v", action)
	}
}

func TestHandleFrame_RoutesWhatsappLogout(t *testing.T) {
	coord := &stubCoordinator{}
	h := &hostRuntime{coord: coord, coordKind: "whatsapp", emitLog: func(string, string, map[string]any) {}}

	action := h.handleFrame(&hostproto.WhatsappLogoutFrame{Type: hostproto.TypeWhatsappLogout})
	if !action.logout {
		t.Fatal("whatsapp_logout did not set logout")
	}
}

// A whatsapp frame while another channel is active must be dropped: driving the
// wrong pairing flow would surface a QR for a channel the user did not pick.
func TestHandleFrame_IgnoresWhatsappFrameForOtherChannel(t *testing.T) {
	coord := &stubCoordinator{}
	h := &hostRuntime{coord: coord, coordKind: "wechat", emitLog: func(string, string, map[string]any) {}}

	action := h.handleFrame(&hostproto.WhatsappBindStartFrame{Type: hostproto.TypeWhatsappBindStart})
	if action.startBind {
		t.Fatal("whatsapp_bind_start should be ignored while wechat is active")
	}
}
