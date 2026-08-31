import { perfSendBegin, perfSendMark } from "@shared/lib/perf-send";
import type { OpenSessionOptions, SendMessageOptions, SessionExecutionMode } from "@shared/store/atoms";
import { newSessionAgentConfigurationAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { useCallback, useRef } from "react";
import { restoreStagedNewSessionSend, stageNewSessionSend } from "../../services/staged-new-session-send";
import type { SendInteractionContext } from "../input-bar/types";

interface NewSessionSendOptions {
	readonly cwd: string;
	readonly executionMode: SessionExecutionMode;
	/**
	 * 发送前必须先跑完的一步，返回真正的目标 cwd（新会话页用它把待创建的项目落盘）。
	 * 返回 null 表示放弃本次发送——重复发送闸门会随之释放，输入内容留在原地。
	 * 不传则直接用 {@link NewSessionSendOptions.cwd}。
	 */
	readonly prepareCwd?: () => Promise<string | null>;
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
	const { cwd, executionMode, prepareCwd, openSession, sendMessage } = options;

	const send = useCallback(
		async (overrideText?: string, context?: SendInteractionContext): Promise<void> => {
			if (sendingRef.current) return;
			sendingRef.current = true;
			const interactionId = context?.interactionId ?? perfSendBegin("new-session-programmatic");
			perfSendMark("new-session-submit", interactionId);
			try {
				const agentConfiguration = structuredClone(getDefaultStore().get(newSessionAgentConfigurationAtom));
				// 准备阶段也在闸门内：连点两下发送不会创建出两个项目。
				const targetCwd = prepareCwd ? await prepareCwd() : cwd;
				if (!targetCwd) return;
				const stagedInput = stageNewSessionSend(overrideText, interactionId);
				if (!stagedInput) return;
				await openSession(targetCwd, undefined, executionMode, {
					interactionId,
					agentConfiguration,
					navigateBeforeCreate: true,
					preserveMessagesBeforeCreate: true,
					onCreateError: () => restoreStagedNewSessionSend(stagedInput),
					onPromptReady: async () => {
						await sendMessage(undefined, { interactionId, stagedInput }).catch((error: unknown) => {
							console.error("[useNewSessionSend] prompt-ready send failed", error);
						});
					},
				});
			} finally {
				sendingRef.current = false;
			}
		},
		[cwd, executionMode, prepareCwd, openSession, sendMessage],
	);

	return { send };
}
