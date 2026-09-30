import { i18n } from "@shared/i18n";
import {
	activeToolNamesAtom,
	type BackgroundTask,
	backgroundTasksBySessionAtom,
	contextCompactionEligibilityAtom,
	contextUsageAtom,
	conversationFeedAtom,
	goalStateBySessionAtom,
	isCompactingAtom,
	isReloadingMcpAtom,
	lastTurnUsageAtom,
	planModeStateBySessionAtom,
	retryProgressAtom,
	subagentsBySessionAtom,
	todoItemsBySessionAtom,
} from "@shared/store/atoms";
import {
	getQueueForSession,
	messageQueueBySessionAtom,
	type QueuedMessage,
	setQueueForSessionAtom,
	setQueuePausedAtom,
} from "@shared/store/message-queue-atoms";
import { showToast } from "@shared/store/toast-atoms";
import {
	isCodingAgentMcpReloadStarted,
	readCodingAgentBackgroundTasksObservation,
	readCodingAgentGoalObservation,
	readCodingAgentMcpReloadFinished,
	readCodingAgentPlanModeObservation,
	readCodingAgentSubagentsObservation,
	readCodingAgentTodoObservation,
} from "@vetta/coding-agent/session-extensions";
import type { SessionEvent } from "@vetta/runtime-core";
import { getDefaultStore, useSetAtom } from "jotai";
import { type MutableRefObject, useCallback } from "react";
import { toChatErrorDetails, turnStatsCache } from "../services/chat-service";
import { clearCachedContextComposition, writeCachedContextComposition } from "../services/context-composition-cache";
import { activeAssistantStartedAt } from "../services/conversation-feed";
import type { ActiveSessionHandle } from "./session-manager-types";

interface SessionStateEventsOptions {
	readonly activeSessionRef: MutableRefObject<ActiveSessionHandle | null>;
	/** Re-read durable history, e.g. after a manual compaction rewrote it. */
	readonly syncDurableHistory: (runtimeId: string, context: string) => void;
}

/** Keyed session state: an empty value removes the entry instead of storing it. */
function withSessionEntry<T>(previous: ReadonlyMap<string, T[]>, runtimeId: string, items: readonly T[]) {
	const next = new Map(previous);
	if (items.length > 0) next.set(runtimeId, [...items]);
	else next.delete(runtimeId);
	return next;
}

/**
 * Session-wide state the chat view shows next to the message list: context usage,
 * compaction, retry progress, the Kernel queue mirror, active tools and Coding
 * Agent extension observations. Message list events go to the conversation feed.
 */
export function useSessionStateEvents({ activeSessionRef, syncDurableHistory }: SessionStateEventsOptions) {
	const setRetryProgress = useSetAtom(retryProgressAtom);
	const setLastTurnUsage = useSetAtom(lastTurnUsageAtom);
	const setContextUsage = useSetAtom(contextUsageAtom);
	const setCompactionEligibility = useSetAtom(contextCompactionEligibilityAtom);
	const setIsCompacting = useSetAtom(isCompactingAtom);
	const setIsReloadingMcp = useSetAtom(isReloadingMcpAtom);
	const setBackgroundTasks = useSetAtom(backgroundTasksBySessionAtom);
	const setSubagents = useSetAtom(subagentsBySessionAtom);
	const setActiveToolNames = useSetAtom(activeToolNamesAtom);
	const setTodoItems = useSetAtom(todoItemsBySessionAtom);
	const setPlanModeStates = useSetAtom(planModeStateBySessionAtom);
	const setGoalStates = useSetAtom(goalStateBySessionAtom);

	const applyExtensionEvent = useCallback(
		(runtimeId: string, event: Extract<SessionEvent, { readonly type: "session.extension" }>) => {
			if (isCodingAgentMcpReloadStarted(event)) {
				setIsReloadingMcp(true);
				return;
			}
			if (readCodingAgentMcpReloadFinished(event)) {
				setIsReloadingMcp(false);
				return;
			}
			const backgroundTasks = readCodingAgentBackgroundTasksObservation(event);
			if (backgroundTasks) {
				setBackgroundTasks((previous) =>
					withSessionEntry(previous, runtimeId, backgroundTasks as readonly BackgroundTask[]),
				);
				return;
			}
			const subagents = readCodingAgentSubagentsObservation(event);
			if (subagents) {
				setSubagents((previous) => withSessionEntry(previous, runtimeId, subagents));
				return;
			}
			const planModeState = readCodingAgentPlanModeObservation(event);
			if (planModeState) {
				setPlanModeStates((previous) => ({ ...previous, [runtimeId]: planModeState }));
				return;
			}
			const goalState = readCodingAgentGoalObservation(event);
			if (goalState !== undefined) {
				setGoalStates((previous) => {
					const next = { ...previous };
					if (goalState) next[runtimeId] = goalState;
					else delete next[runtimeId];
					return next;
				});
				return;
			}
			const todoItems = readCodingAgentTodoObservation(event);
			if (todoItems) setTodoItems((previous) => withSessionEntry(previous, runtimeId, todoItems));
		},
		[setBackgroundTasks, setGoalStates, setIsReloadingMcp, setPlanModeStates, setSubagents, setTodoItems],
	);

	return useCallback(
		(runtimeId: string, event: SessionEvent) => {
			if (event.channel === "assistant") return;
			switch (event.type) {
				case "session.context.state":
					setContextUsage({
						percent: event.state.usage.percent,
						contextTokens: event.state.usage.tokens,
						contextWindow: event.state.usage.contextWindow,
						...(event.state.usage.composition ? { composition: event.state.usage.composition } : {}),
					});
					setIsCompacting(event.state.compaction.status === "running");
					setCompactionEligibility(event.state.compaction.eligibility);
					return;
				// Kernel queue snapshot (ADR-0060). Its disappearance never means consumption;
				// conversation.message.appended alone decides when a queued message joins a Turn.
				case "queue.changed": {
					const store = getDefaultStore();
					const items: QueuedMessage[] = event.entries.map((entry) => ({
						id: entry.id,
						displayText: entry.displayText,
						behavior: entry.behavior,
						kind: entry.kind ?? "message",
					}));
					store.set(setQueueForSessionAtom, { runtimeId, items });
					store.set(setQueuePausedAtom, { runtimeId, paused: event.paused });
					return;
				}
				// 自动重试的退避等待；错误本身要等重试彻底失败才会来。
				case "retry.start":
					setRetryProgress({
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						errorMessage: event.errorMessage,
						...(event.failure ? { details: toChatErrorDetails(event.failure) } : {}),
					});
					return;
				case "retry.end":
					setRetryProgress(null);
					return;
				// Emitted per persisted assistant message.
				case "usage.update": {
					const startedAt = activeAssistantStartedAt(getDefaultStore().get(conversationFeedAtom).items);
					const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
					const turnStats = { outputSpeed: elapsed > 0 ? event.output / elapsed : 0, durationSeconds: elapsed };
					setLastTurnUsage(turnStats);
					// Cached for session restore.
					const sessionPath = activeSessionRef.current?.sessionPath;
					if (sessionPath != null) turnStatsCache.set(sessionPath, turnStats);
					if (sessionPath && event.contextComposition) {
						writeCachedContextComposition(sessionPath, event.contextComposition);
					}
					setContextUsage({
						percent: event.contextPercent ?? null,
						contextTokens: event.contextTokens ?? null,
						contextWindow: event.contextWindow ?? 0,
						...(event.contextComposition ? { composition: event.contextComposition } : {}),
					});
					return;
				}
				case "compaction.start":
					setIsCompacting(true);
					return;
				case "compaction.end":
					setIsCompacting(false);
					if (event.success) {
						const sessionPath = activeSessionRef.current?.sessionPath;
						if (sessionPath) clearCachedContextComposition(sessionPath);
						if (event.contextWindow !== undefined) {
							setContextUsage({
								percent: event.contextPercent ?? null,
								contextTokens: event.contextTokens ?? null,
								contextWindow: event.contextWindow,
							});
						}
						if (
							event.reason === "manual" &&
							getQueueForSession(getDefaultStore().get(messageQueueBySessionAtom), runtimeId).length === 0
						) {
							syncDurableHistory(runtimeId, "compaction");
						}
					} else if (event.reason === "manual") {
						showToast({
							variant: "error",
							title: i18n.t("chat:slashPanel.compaction.errorTitle"),
							message: event.errorMessage ?? i18n.t("chat:slashPanel.compaction.errorMessage"),
						});
					}
					return;
				// 插件在会话创建之后才注册工具：openSession 的 getState 快照可能早于插件 activate，
				// 不刷新的话输入栏 badge 的 requiresActiveTool 闸门会一直按旧集合隐藏。
				case "active_tools_update":
					setActiveToolNames(new Set(event.activeToolNames));
					return;
				case "session.extension":
					applyExtensionEvent(runtimeId, event);
					return;
				default:
					return;
			}
		},
		[
			activeSessionRef,
			applyExtensionEvent,
			setActiveToolNames,
			setCompactionEligibility,
			setContextUsage,
			setIsCompacting,
			setLastTurnUsage,
			setRetryProgress,
			syncDurableHistory,
		],
	);
}
