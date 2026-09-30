import { i18n } from "@shared/i18n";
import {
	activeSessionStreamingAtom,
	activeToolNamesAtom,
	type BackgroundTask,
	backgroundTasksBySessionAtom,
	type ChatConversationItem,
	contextCompactionEligibilityAtom,
	contextUsageAtom,
	conversationFeedAtom,
	goalStateBySessionAtom,
	isCompactingAtom,
	isReloadingMcpAtom,
	lastTurnUsageAtom,
	planModeStateBySessionAtom,
	projectsAtom,
	promptPredictingAtom,
	promptSuggestionsAtom,
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
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { fullHistoryToChat, getChatStreamOwner, toChatErrorDetails, turnStatsCache } from "../services/chat-service";
import { clearCachedContextComposition, writeCachedContextComposition } from "../services/context-composition-cache";
import { activeAssistantStartedAt, type ConversationFeedAction } from "../services/conversation-feed";
import { dispatchConversationFeed, nextConversationHistoryRevision } from "../services/conversation-feed-store";
import type { ActiveSessionHandle } from "./session-manager-types";

const DELTA_FLUSH_INTERVAL_MS = 100;
// Keep a 100ms ceiling rather than rAF: markdown re-parse of the live tail is the
// expensive work, and a 120Hz display would otherwise commit ~2× more parses.

export interface SessionEventController {
	bumpSuggestionToken: (runtimeId: string) => void;
	createSessionEventHandler: (runtimeId: string) => (event: SessionEvent) => void;
	resetEventBuffers: () => void;
	/** Queue this Runtime's feed writes, in order, until its attach snapshot is applied. */
	holdFeedWrites: (runtimeId: string) => void;
	releaseFeedWrites: (runtimeId: string) => void;
}

interface SessionEventControllerOptions {
	activeSessionRef: MutableRefObject<ActiveSessionHandle | null>;
}

function getProjects() {
	return getDefaultStore().get(projectsAtom);
}

/** Events that change the message list; the feed reducer is their only consumer. */
function isConversationFeedEvent(event: SessionEvent): boolean {
	if (event.channel === "assistant") return true;
	switch (event.type) {
		case "conversation.turn.started":
		case "conversation.turn.completed":
		case "conversation.turn.cancelled":
		case "conversation.turn.failed":
		case "conversation.message.appended":
		case "model.request.started":
		case "tool.start":
		case "tool.phase":
		case "tool.end":
		case "error":
			return true;
		default:
			return false;
	}
}

/** High-frequency stream fragments are batched; everything else is applied in order immediately. */
function isDeferrableFeedEvent(event: SessionEvent): boolean {
	return (
		event.channel === "assistant" &&
		(event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta")
	);
}

export function useSessionEventController({ activeSessionRef }: SessionEventControllerOptions): SessionEventController {
	const setActiveSessionStreaming = useSetAtom(activeSessionStreamingAtom);
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
	const setPromptSuggestions = useSetAtom(promptSuggestionsAtom);
	const setPromptPredicting = useSetAtom(promptPredictingAtom);
	const suggestionTokenRef = useRef<Map<string, number>>(new Map());
	const pendingFeedEventsRef = useRef<{ runtimeId: string; events: SessionEvent[] } | null>(null);
	const flushTimerRef = useRef<number | null>(null);
	const heldWritesRef = useRef<{ runtimeId: string; actions: ConversationFeedAction[] } | null>(null);
	const activeTurnIdRef = useRef<string | null>(null);

	const markPredicting = useCallback(
		(runtimeId: string, predicting: boolean) => {
			setPromptPredicting((previous) => {
				if (predicting) return { ...previous, [runtimeId]: true };
				if (!(runtimeId in previous)) return previous;
				const next = { ...previous };
				delete next[runtimeId];
				return next;
			});
		},
		[setPromptPredicting],
	);

	const bumpSuggestionToken = useCallback((runtimeId: string) => {
		const tokens = suggestionTokenRef.current;
		tokens.set(runtimeId, (tokens.get(runtimeId) ?? 0) + 1);
	}, []);

	const writeFeed = useCallback((action: ConversationFeedAction & { readonly runtimeId: string }) => {
		const held = heldWritesRef.current;
		if (held?.runtimeId === action.runtimeId) {
			held.actions.push(action);
			return;
		}
		dispatchConversationFeed(action);
	}, []);

	const flushFeedEvents = useCallback(() => {
		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		const pending = pendingFeedEventsRef.current;
		pendingFeedEventsRef.current = null;
		if (!pending || pending.events.length === 0) return;
		// The feed only accepts events of the Runtime it is bound to, so a stale
		// subscription cannot write into the session now on screen.
		writeFeed({ type: "runtime.events", runtimeId: pending.runtimeId, events: pending.events });
	}, [writeFeed]);

	const enqueueFeedEvent = useCallback(
		(runtimeId: string, event: SessionEvent) => {
			if (pendingFeedEventsRef.current && pendingFeedEventsRef.current.runtimeId !== runtimeId) flushFeedEvents();
			const pending = pendingFeedEventsRef.current ?? { runtimeId, events: [] };
			pending.events.push(event);
			pendingFeedEventsRef.current = pending;
			if (!isDeferrableFeedEvent(event)) {
				flushFeedEvents();
			} else if (flushTimerRef.current === null) {
				flushTimerRef.current = window.setTimeout(flushFeedEvents, DELTA_FLUSH_INTERVAL_MS);
			}
		},
		[flushFeedEvents],
	);

	const resetEventBuffers = useCallback(() => {
		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		pendingFeedEventsRef.current = null;
		heldWritesRef.current = null;
		activeTurnIdRef.current = null;
	}, []);

	const holdFeedWrites = useCallback(
		(runtimeId: string) => {
			flushFeedEvents();
			heldWritesRef.current = { runtimeId, actions: [] };
		},
		[flushFeedEvents],
	);

	const releaseFeedWrites = useCallback(
		(runtimeId: string) => {
			if (heldWritesRef.current?.runtimeId !== runtimeId) return;
			flushFeedEvents();
			const held = heldWritesRef.current;
			heldWritesRef.current = null;
			for (const action of held.actions) dispatchConversationFeed(action);
		},
		[flushFeedEvents],
	);

	useEffect(() => resetEventBuffers, [resetEventBuffers]);

	/** 每轮正常完成后基于最近几轮对话异步生成 0-3 条输入建议，回填时校验过期。 */
	const predictNextPrompts = useCallback(
		(runtimeId: string) => {
			const cwd = activeSessionRef.current?.cwd;
			const projectType = cwd ? getProjects().find((project) => project.cwd === cwd)?.type : undefined;
			if (projectType === "batch") return;
			const conversation = buildRecentConversation(getDefaultStore().get(conversationFeedAtom).items);
			const token = suggestionTokenRef.current.get(runtimeId) ?? 0;
			void (async () => {
				try {
					const config = await window.vetta.config.get();
					if (config.experimental?.promptPrediction !== true) return;
					if (!conversation) return;
					// 进入「生成中」：末条 assistant 操作栏显示闪光提示。
					markPredicting(runtimeId, true);
					const suggestions = await window.vetta.session.nextPromptSuggestions(runtimeId, conversation);
					// 过期判定：该会话期间已开新轮 / 发新 prompt 则丢弃。
					if ((suggestionTokenRef.current.get(runtimeId) ?? 0) !== token) return;
					setPromptSuggestions((previous) => {
						if (suggestions.length > 0) return { ...previous, [runtimeId]: suggestions };
						if (!(runtimeId in previous)) return previous;
						const next = { ...previous };
						delete next[runtimeId];
						return next;
					});
				} catch (error) {
					console.warn("[useSessionManager] prompt prediction failed", error);
				} finally {
					markPredicting(runtimeId, false);
				}
			})();
		},
		[activeSessionRef, markPredicting, setPromptSuggestions],
	);

	/** Durable history supplies entry ids, branches and timing that live events do not carry. */
	const syncDurableHistory = useCallback(
		(runtimeId: string, context: string) => {
			const revision = nextConversationHistoryRevision();
			void window.vetta.session
				.getFullHistory(runtimeId)
				.then((history) => {
					writeFeed({ type: "history.loaded", runtimeId, items: fullHistoryToChat(history), revision });
				})
				.catch((error) => {
					console.warn(`[useSessionManager] history refresh after ${context} failed`, error);
				});
		},
		[writeFeed],
	);

	const createSessionEventHandler = useCallback(
		(sessionId: string) => (event: SessionEvent) => {
			// Defensive guard: if user has already switched away to another
			// session, drop this event so its session-wide state can't bleed into
			// the new session's atoms. activeSessionRef is updated synchronously
			// and reflects the latest user-facing session.
			if (activeSessionRef.current?.runtimeId !== sessionId) return;
			// 归属闸门：activeSessionRef 是实例级的，只能证明「本实例最后打开的是它」。
			// 真正代表用户当前会话的是模块级 owner，它在 openSession 一进入就被置空——
			// 切走后旧会话的事件到此为止。
			if (getChatStreamOwner() !== sessionId) return;
			if (event.type === "session.context.state") {
				setContextUsage({
					percent: event.state.usage.percent,
					contextTokens: event.state.usage.tokens,
					contextWindow: event.state.usage.contextWindow,
					...(event.state.usage.composition ? { composition: event.state.usage.composition } : {}),
				});
				setIsCompacting(event.state.compaction.status === "running");
				setCompactionEligibility(event.state.compaction.eligibility);
				return;
			}
			if (isConversationFeedEvent(event)) {
				enqueueFeedEvent(sessionId, event);
				if (event.type === "conversation.turn.started") {
					// 新一轮开始：让上一轮的输入预测生成（若仍在飞）回填时作废。
					bumpSuggestionToken(sessionId);
					activeTurnIdRef.current = event.turnId;
					setActiveSessionStreaming(true);
				} else if (
					event.type === "conversation.turn.completed" ||
					event.type === "conversation.turn.cancelled" ||
					event.type === "conversation.turn.failed"
				) {
					setRetryProgress(null);
					// Only the running Turn's terminal fact ends streaming; a late one for an older Turn does not.
					if (activeTurnIdRef.current === null || activeTurnIdRef.current === event.turnId) {
						activeTurnIdRef.current = null;
						setActiveSessionStreaming(false);
					}
					syncDurableHistory(sessionId, "Turn terminal");
					if (event.type === "conversation.turn.completed") predictNextPrompts(sessionId);
				} else if (event.type === "error") {
					setRetryProgress(null);
				}
				return;
			}
			// ── Kernel queue snapshot (ADR-0060) ──
			// Snapshot disappearance is deliberately not interpreted as message
			// consumption. Durable conversation.message.appended is the only source
			// of truth for when a queued user message becomes part of a Turn.
			if (event.type === "queue.changed") {
				const queueStore = getDefaultStore();
				const nextQueue: QueuedMessage[] = event.entries.map((entry) => ({
					id: entry.id,
					displayText: entry.displayText,
					behavior: entry.behavior,
					kind: entry.kind ?? "message",
				}));
				queueStore.set(setQueueForSessionAtom, { runtimeId: sessionId, items: nextQueue });
				queueStore.set(setQueuePausedAtom, { runtimeId: sessionId, paused: event.paused });
				return;
			}

			// ── Auto-retry（退避等待中；错误本身要等重试彻底失败才会来）──
			if (event.type === "retry.start") {
				setRetryProgress({
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					errorMessage: event.errorMessage,
					...(event.failure ? { details: toChatErrorDetails(event.failure) } : {}),
				});
				return;
			}
			if (event.type === "retry.end") {
				setRetryProgress(null);
				return;
			}

			// ── Usage update (emitted per assistant message) ──
			if (event.type === "usage.update") {
				const startedAt = activeAssistantStartedAt(getDefaultStore().get(conversationFeedAtom).items);
				const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
				const outputSpeed = elapsed > 0 ? event.output / elapsed : 0;
				const turnStats = { outputSpeed, durationSeconds: elapsed };
				setLastTurnUsage(turnStats);
				// Cache turn stats for session restore
				const sp = activeSessionRef.current?.sessionPath;
				if (sp != null) turnStatsCache.set(sp, turnStats);
				if (sp && event.contextComposition) {
					writeCachedContextComposition(sp, event.contextComposition);
				}
				setContextUsage({
					percent: event.contextPercent ?? null,
					contextTokens: event.contextTokens ?? null,
					contextWindow: event.contextWindow ?? 0,
					...(event.contextComposition ? { composition: event.contextComposition } : {}),
				});
				return;
			}

			// ── Compaction start ──
			if (event.type === "compaction.start") {
				setIsCompacting(true);
				return;
			}

			// ── Compaction end ──
			if (event.type === "compaction.end") {
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
						getQueueForSession(getDefaultStore().get(messageQueueBySessionAtom), sessionId).length === 0
					) {
						syncDurableHistory(sessionId, "compaction");
					}
				} else if (event.reason === "manual") {
					showToast({
						variant: "error",
						title: i18n.t("chat:slashPanel.compaction.errorTitle"),
						message: event.errorMessage ?? i18n.t("chat:slashPanel.compaction.errorMessage"),
					});
				}
				return;
			}

			// ── 激活工具集变化（插件在会话创建之后才注册工具）──
			// openSession 时拿到的 getState 快照可能早于插件 activate，不刷新的话
			// 输入栏 badge 的 requiresActiveTool 闸门会一直按旧集合隐藏。
			if (event.type === "active_tools_update") {
				if (event.sessionId === activeSessionRef.current?.runtimeId) {
					setActiveToolNames(new Set(event.activeToolNames));
				}
				return;
			}

			// ── Coding Agent product extension updates ──
			if (event.type === "session.extension") {
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
					const sid = activeSessionRef.current?.runtimeId;
					if (sid) {
						setBackgroundTasks((prev) => {
							const next = new Map(prev);
							if (backgroundTasks.length > 0) next.set(sid, [...backgroundTasks] as BackgroundTask[]);
							else next.delete(sid);
							return next;
						});
					}
					return;
				}
				const subagents = readCodingAgentSubagentsObservation(event);
				if (subagents) {
					const sid = activeSessionRef.current?.runtimeId;
					if (sid) {
						setSubagents((prev) => {
							const next = new Map(prev);
							if (subagents.length > 0) {
								next.set(sid, [...subagents]);
							} else {
								next.delete(sid);
							}
							return next;
						});
					}
					return;
				}
				const planModeState = readCodingAgentPlanModeObservation(event);
				if (planModeState) {
					const sid = activeSessionRef.current?.runtimeId;
					if (sid) setPlanModeStates((prev) => ({ ...prev, [sid]: planModeState }));
					return;
				}
				const goalState = readCodingAgentGoalObservation(event);
				if (goalState !== undefined) {
					const sid = activeSessionRef.current?.runtimeId;
					if (sid) {
						setGoalStates((previous) => {
							const next = { ...previous };
							if (goalState) next[sid] = goalState;
							else delete next[sid];
							return next;
						});
					}
					return;
				}
				const items = readCodingAgentTodoObservation(event);
				if (!items) return;
				const sid = activeSessionRef.current?.runtimeId;
				if (sid) {
					setTodoItems((prev) => {
						const next = new Map(prev);
						if (items.length > 0) {
							next.set(sid, [...items]);
						} else {
							next.delete(sid);
						}
						return next;
					});
				}
				return;
			}
		},
		[
			activeSessionRef,
			bumpSuggestionToken,
			enqueueFeedEvent,
			predictNextPrompts,
			setActiveSessionStreaming,
			setActiveToolNames,
			setBackgroundTasks,
			setContextUsage,
			setIsCompacting,
			setIsReloadingMcp,
			setLastTurnUsage,
			setPlanModeStates,
			setGoalStates,
			setRetryProgress,
			setSubagents,
			setTodoItems,
			setCompactionEligibility,
			syncDurableHistory,
		],
	);

	return { bumpSuggestionToken, createSessionEventHandler, resetEventBuffers, holdFeedWrites, releaseFeedWrites };
}

function buildRecentConversation(messages: readonly ChatConversationItem[]): string {
	const relevant = messages.filter((message) => message.kind !== "event");
	let startIndex = relevant.length;
	let userCount = 0;
	for (let index = relevant.length - 1; index >= 0; index--) {
		if (relevant[index].kind === "user") {
			userCount++;
			startIndex = index;
			if (userCount >= 3) break;
		}
	}
	const lines: string[] = [];
	for (const message of relevant.slice(startIndex)) {
		const text = (message.text ?? "").trim();
		if (!text) continue;
		lines.push(`${message.kind === "user" ? "User" : "Assistant"}: ${text.slice(0, 600)}`);
	}
	return lines.join("\n\n").slice(0, 4000);
}
