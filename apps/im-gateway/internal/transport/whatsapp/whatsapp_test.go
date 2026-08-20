package whatsapp

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"vetta-im-gateway/internal/transport"
)

func TestNewRequiresStatePath(t *testing.T) {
	if _, err := New(Options{}); err == nil {
		t.Fatal("New must reject empty StatePath")
	}
}

func TestNewCreatesStoreAndStartsUnpaired(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "whatsapp.db")
	tr, err := New(Options{StatePath: statePath})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if tr.LoggedIn() {
		t.Fatal("fresh store must not be logged in")
	}
	if _, err := os.Stat(statePath); err != nil {
		t.Fatalf("sqlite store not created: %v", err)
	}

	handler := transport.MessageHandlerFunc(func(context.Context, transport.InboundMessage) error { return nil })
	err = tr.Start(context.Background(), handler)
	if !errors.Is(err, ErrNotLoggedIn) {
		t.Fatalf("Start on unpaired store = %v, want ErrNotLoggedIn", err)
	}
}

func TestCapabilities(t *testing.T) {
	tr := &Transport{}
	caps := tr.Capabilities()
	if !caps.SupportsMessageEdit || caps.SupportsCards || caps.SupportsButtons ||
		!caps.SupportsFileUpload || !caps.SupportsThreads || !caps.SupportsReactions {
		t.Fatalf("unexpected capabilities: %+v", caps)
	}
	if caps.MaxMessageLength != 60000 {
		t.Fatalf("MaxMessageLength = %d", caps.MaxMessageLength)
	}
}

func TestStopIsIdempotent(t *testing.T) {
	tr, err := New(Options{StatePath: filepath.Join(t.TempDir(), "wa.db")})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := tr.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := tr.Stop(); err != nil {
		t.Fatalf("second Stop: %v", err)
	}
}

// TestIntegrationPairAndConnect exercises the real WhatsApp servers. Gated:
//
//	WHATSAPP_INTEGRATION_TEST=1 go test -run Integration -v -timeout 5m ./internal/transport/whatsapp/
//
// With an unpaired store it prints QR codes to scan; with a paired store
// (set WHATSAPP_STATE_PATH) it connects and disconnects.
func TestIntegrationPairAndConnect(t *testing.T) {
	if os.Getenv("WHATSAPP_INTEGRATION_TEST") != "1" {
		t.Skip("set WHATSAPP_INTEGRATION_TEST=1 to run against real WhatsApp servers")
	}
	statePath := os.Getenv("WHATSAPP_STATE_PATH")
	if statePath == "" {
		statePath = filepath.Join(t.TempDir(), "wa-integration.db")
	}
	tr, err := New(Options{StatePath: statePath})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = tr.Stop() }()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	if tr.LoggedIn() {
		handler := transport.MessageHandlerFunc(func(_ context.Context, msg transport.InboundMessage) error {
			t.Logf("inbound: %+v", msg)
			return nil
		})
		go func() {
			time.Sleep(10 * time.Second)
			_ = tr.Stop()
		}()
		if err := tr.Start(ctx, handler); err != nil {
			t.Fatalf("Start: %v", err)
		}
		return
	}

	events, err := tr.PairQR(ctx)
	if err != nil {
		t.Fatalf("PairQR: %v", err)
	}
	for evt := range events {
		switch {
		case evt.QRCode != "":
			t.Logf("scan QR code: %s", evt.QRCode)
		case evt.Done:
			t.Log("pairing complete")
			return
		case evt.Err != nil:
			t.Fatalf("pairing failed: %v", evt.Err)
		}
	}
}
