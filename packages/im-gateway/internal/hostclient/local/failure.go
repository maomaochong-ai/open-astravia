package local

import (
	"context"
	"fmt"

	"vetta-im-gateway/internal/hostclient"
)

func newHostFailure(
	code hostclient.FailureCode,
	phase hostclient.FailurePhase,
	recoverability hostclient.FailureRecoverability,
	message string,
	cause error,
) *hostclient.HostFailure {
	return &hostclient.HostFailure{
		Code:           code,
		Phase:          phase,
		Recoverability: recoverability,
		Message:        message,
		Cause:          cause,
	}
}

func failureFromResponse(resp hostclient.Response, fallbackPhase hostclient.FailurePhase) *hostclient.HostFailure {
	code := resp.ErrorCode
	if code == "" {
		code = hostclient.FailureCodeCommandFailed
	}
	phase := resp.Phase
	if phase == "" {
		phase = fallbackPhase
	}
	recoverability := resp.Recoverability
	if recoverability == "" {
		recoverability = hostclient.FailureContinueSession
	}
	return newHostFailure(code, phase, recoverability, resp.Error, nil)
}

func contextFailure(err error, commandType string) *hostclient.HostFailure {
	code := hostclient.FailureCodeRequestCancelled
	if err == context.DeadlineExceeded {
		code = hostclient.FailureCodeRequestTimeout
	}
	return newHostFailure(
		code,
		commandPhase(commandType),
		hostclient.FailureContinueSession,
		fmt.Sprintf("hostclient/local: command %s cancelled: %v", commandType, err),
		err,
	)
}

func commandPhase(commandType string) hostclient.FailurePhase {
	switch commandType {
	case hostclient.CommandTypePrompt, hostclient.CommandTypeAbort:
		return hostclient.FailurePhaseTurn
	case hostclient.CommandTypeNewSession, hostclient.CommandTypeSwitchSession:
		return hostclient.FailurePhaseTransition
	default:
		return hostclient.FailurePhaseCommand
	}
}
