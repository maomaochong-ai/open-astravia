import type { ConversationParticipantViewModel } from "@shared/conversation";
import {
	activeSessionAtom,
	chatMessagesAtom,
	isConversationBusyAtom,
	pendingScrollToEntryAtom,
	promptPredictingAtom,
} from "@shared/store/atoms";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useCallback, useMemo } from "react";
import { type ConversationFeed, createConversationFeed } from "../conversation-view";
import { sessionUserMessageCommands } from "./session-user-message-commands";

const activeRuntimeIdAtom = selectAtom(activeSessionAtom, (session) => session?.runtimeId ?? null);
const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? null);

interface SessionConversationFeedInput {
	/** The session shown, by durable path (or a pending open's target path). */
	readonly key: string | null;
	readonly workspace: ActivityWorkspace;
	readonly participants?: readonly ConversationParticipantViewModel[];
	readonly pendingLabel?: string;
	readonly abort?: () => void;
}

/**
 * The active session as a conversation feed. Messages and streaming state are
 * the session atoms themselves, so the composed view subscribes to them and the
 * composition above it does not re-render on every streamed delta.
 */
export function useSessionConversationFeed({
	key,
	workspace,
	participants,
	pendingLabel,
	abort,
}: SessionConversationFeedInput): ConversationFeed {
	const runtimeId = useAtomValue(activeRuntimeIdAtom);
	const sessionPath = useAtomValue(activeSessionPathAtom);
	const scrollEntry = useAtomValue(pendingScrollToEntryAtom);
	const setScrollEntry = useSetAtom(pendingScrollToEntryAtom);
	const onScrollTargetReached = useCallback(() => setScrollEntry(null), [setScrollEntry]);
	// 断网把回合停在半路时，重连后要能就地续写；只对当前展示的会话给这个动作，
	// 避免在旧快照上误续一个别的会话。
	const resumeInterruptedTurn = useCallback(() => {
		if (!runtimeId) return;
		void window.astravia.session.continue(runtimeId).catch(() => undefined);
	}, [runtimeId]);
	const predicting = useMemo(
		() => selectAtom(promptPredictingAtom, (map) => (runtimeId ? Boolean(map[runtimeId]) : false)),
		[runtimeId],
	);
	// Subagent cards belong to the Runtime only once the shown session is that Runtime's.
	const subagentRuntimeId = key && key === sessionPath ? (runtimeId ?? undefined) : undefined;
	const canResume = key !== null && key === sessionPath && runtimeId !== null;
	return useMemo(
		() =>
			createConversationFeed({
				key,
				items: chatMessagesAtom,
				streaming: isConversationBusyAtom,
				predicting,
				workspace,
				...(participants ? { participants } : {}),
				...(pendingLabel ? { pendingLabel } : {}),
				...(scrollEntry ? { scrollTarget: { key: scrollEntry.entryId, onReached: onScrollTargetReached } } : {}),
				capabilities: {
					userMessageCommands: sessionUserMessageCommands,
					...(abort ? { abort } : {}),
					...(canResume ? { resumeInterruptedTurn } : {}),
					...(subagentRuntimeId ? { subagentRuntimeId } : {}),
				},
			}),
		[
			key,
			predicting,
			workspace,
			participants,
			pendingLabel,
			scrollEntry,
			onScrollTargetReached,
			abort,
			subagentRuntimeId,
			canResume,
			resumeInterruptedTurn,
		],
	);
}
