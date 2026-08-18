import { perfSendBegin, perfSendMark } from "@shared/lib/perf-send";
import type { OpenSessionOptions, SendMessageOptions, SessionExecutionMode } from "@shared/store/atoms";
import { useCallback, useRef } from "react";
import type { SendInteractionContext } from "../input-bar/types";

interface NewSessionSendOptions {
	readonly cwd: string;
	readonly executionMode: SessionExecutionMode;
	readonly openSession: (
		cwd: string,
		sessionPath?: string,
		executionMode?: SessionExecutionMode,
		options?: OpenSessionOptions,
	) => Promise<void>;
	readonly sendMessage: (overrideText?: string, options?: SendMessageOptions) => Promise<unknown>;
}

export function useNewSessionSend(options: NewSessionSendOptions): {
	readonly send: (overrideText?: string, context?: SendInteractionContext) => Promise<void>;
} {
	const sendingRef = useRef(false);
	const { cwd, executionMode, openSession, sendMessage } = options;

	const send = useCallback(
		async (overrideText?: string, context?: SendInteractionContext): Promise<void> => {
			if (sendingRef.current) return;
			sendingRef.current = true;
			const interactionId = context?.interactionId ?? perfSendBegin("new-session-programmatic");
			perfSendMark("new-session-submit", interactionId);
			try {
				await openSession(cwd, undefined, executionMode, {
					interactionId,
					onPromptReady: () => {
						void sendMessage(overrideText, { interactionId }).catch((error: unknown) => {
							console.error("[useNewSessionSend] prompt-ready send failed", error);
						});
					},
				});
			} finally {
				sendingRef.current = false;
			}
		},
		[cwd, executionMode, openSession, sendMessage],
	);

	return { send };
}
