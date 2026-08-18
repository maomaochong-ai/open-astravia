package local

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"vetta-im-gateway/internal/hostclient"
)

type bufferWriteCloser struct {
	bytes.Buffer
}

func (w *bufferWriteCloser) Close() error { return nil }

var _ io.WriteCloser = (*bufferWriteCloser)(nil)

func TestSessionSendConvertsFailedResponseToTypedFailure(t *testing.T) {
	s := &session{
		stdin:   &bufferWriteCloser{},
		pending: make(map[string]chan hostclient.Response),
		exited:  make(chan struct{}),
	}

	done := make(chan error, 1)
	go func() {
		_, err := s.Send(context.Background(), hostclient.Command{Type: hostclient.CommandTypePrompt})
		done <- err
	}()

	waitForPendingResponse(t, s, "im-1")

	s.deliverResponse("im-1", hostclient.Response{
		ID:             "im-1",
		Command:        hostclient.CommandTypePrompt,
		Success:        false,
		Error:          "provider failed",
		ErrorCode:      "provider_unavailable",
		Phase:          hostclient.FailurePhaseTurn,
		Recoverability: hostclient.FailureContinueSession,
	})

	select {
	case err := <-done:
		var failure hostclient.TypedFailure
		if !errors.As(err, &failure) {
			t.Fatalf("expected typed failure, got %T: %v", err, err)
		}
		if failure.FailureCode() != "provider_unavailable" || failure.FailurePhase() != hostclient.FailurePhaseTurn {
			t.Fatalf("unexpected failure metadata: code=%q phase=%q", failure.FailureCode(), failure.FailurePhase())
		}
	case <-time.After(time.Second):
		t.Fatal("Send did not return after failed response")
	}
}

func TestHandshakePreservesCorrelatedWireFailure(t *testing.T) {
	s := &session{
		stdin:   &bufferWriteCloser{},
		pending: make(map[string]chan hostclient.Response),
		events:  make(chan hostclient.AgentEvent),
		exited:  make(chan struct{}),
	}

	done := make(chan error, 1)
	go func() { done <- s.handshake(context.Background(), time.Second) }()
	waitForPendingResponse(t, s, "im-1")
	s.deliverResponse("im-1", hostclient.Response{
		ID:             "im-1",
		Command:        hostclient.CommandTypeGetState,
		Success:        false,
		Error:          "startup configuration failed",
		ErrorCode:      "configuration_invalid",
		Phase:          hostclient.FailurePhaseStartup,
		Recoverability: hostclient.FailureUserAction,
	})

	select {
	case err := <-done:
		var failure hostclient.TypedFailure
		if !errors.As(err, &failure) {
			t.Fatalf("expected typed failure, got %T: %v", err, err)
		}
		if failure.FailureCode() != "configuration_invalid" ||
			failure.FailureRecoverability() != hostclient.FailureUserAction {
			t.Fatalf("wire failure was replaced: code=%q recoverability=%q", failure.FailureCode(), failure.FailureRecoverability())
		}
	case <-time.After(time.Second):
		t.Fatal("handshake did not return after failed response")
	}
}

func waitForPendingResponse(t *testing.T, s *session, id string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		s.pendingMu.Lock()
		_, waiting := s.pending[id]
		s.pendingMu.Unlock()
		if waiting {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("request %s did not register its pending response", id)
		}
		time.Sleep(time.Millisecond)
	}
}
