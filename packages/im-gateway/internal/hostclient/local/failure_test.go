package local

import (
	"context"
	"errors"
	"testing"

	"vetta-im-gateway/internal/hostclient"
)

func TestFailureFromResponsePreservesWireMetadata(t *testing.T) {
	failure := failureFromResponse(hostclient.Response{
		Error:          "provider failed",
		ErrorCode:      "provider_unavailable",
		Phase:          hostclient.FailurePhaseTurn,
		Recoverability: hostclient.FailureContinueSession,
	}, hostclient.FailurePhaseCommand)

	if failure.FailureCode() != "provider_unavailable" {
		t.Fatalf("failure code: %q", failure.FailureCode())
	}
	if failure.FailurePhase() != hostclient.FailurePhaseTurn {
		t.Fatalf("failure phase: %q", failure.FailurePhase())
	}
	if failure.FailureRecoverability() != hostclient.FailureContinueSession {
		t.Fatalf("failure recoverability: %q", failure.FailureRecoverability())
	}
}

func TestContextFailureDistinguishesTimeoutWithoutStringParsing(t *testing.T) {
	failure := contextFailure(context.DeadlineExceeded, hostclient.CommandTypePrompt)

	if failure.FailureCode() != hostclient.FailureCodeRequestTimeout {
		t.Fatalf("failure code: %q", failure.FailureCode())
	}
	if failure.FailurePhase() != hostclient.FailurePhaseTurn {
		t.Fatalf("failure phase: %q", failure.FailurePhase())
	}
	if !errors.Is(failure, context.DeadlineExceeded) {
		t.Fatal("failure must preserve the context cause")
	}
}
