import { pluginSendMessageRef } from "@domains/plugins/runtime/plugin-host-bridge";
import {
	openSessionFnRef,
	type SendMessageOptions,
	type SendMessageResult,
	type SessionExecutionMode,
	sendMessageFnRef,
} from "@shared/store/atoms";
import type { MutableRefObject } from "react";
import { useSessionMessageSender } from "./useSessionMessageSender";
import { useSessionOpener } from "./useSessionOpener";

interface SessionManagerResult {
	openSession: (
		cwd: string,
		sessionPath?: string,
		executionMode?: SessionExecutionMode,
		options?: { navigate?: boolean },
	) => Promise<void>;
	sendMessage: (overrideText?: string, options?: SendMessageOptions) => Promise<SendMessageResult | undefined>;
	abortMessage: () => Promise<void>;
	sendQueuedNow: (runtimeId: string, id: string) => Promise<void>;
	openSessionRef: MutableRefObject<SessionManagerResult["openSession"] | undefined>;
}

export function useSessionManager(): SessionManagerResult {
	const { openSession, openSessionRef, bumpSuggestionToken } = useSessionOpener();
	const { sendMessage, abortMessage, sendQueuedNow } = useSessionMessageSender({
		bumpSuggestionToken,
	});

	openSessionFnRef.current = openSession;
	pluginSendMessageRef.current = sendMessage;
	sendMessageFnRef.current = sendMessage;

	return { openSession, sendMessage, abortMessage, sendQueuedNow, openSessionRef };
}
