import { createConversationUserMessage } from "@shared/conversation";
import {
	activeSessionStreamingAtom,
	activeToolNamesAtom,
	type BackgroundTask,
	backgroundTasksBySessionAtom,
	type ChatConversationItem,
	chatMessagesAtom,
	contextUsageAtom,
	isCompactingAtom,
	isReloadingMcpAtom,
	lastTurnUsageAtom,
	projectsAtom,
	promptPredictingAtom,
	promptSuggestionsAtom,
	retryProgressAtom,
	subagentsBySessionAtom,
	todoItemsBySessionAtom,
} from "@shared/store/atoms";
import {
	getQueuedDispatchSeq,
	getQueueForSession,
	messageQueueBySessionAtom,
	type QueuedMessage,
	setQueueForSessionAtom,
	setQueuePausedAtom,
} from "@shared/store/message-queue-atoms";
import {
	isCodingAgentMcpReloadStarted,
	readCodingAgentBackgroundTasksObservation,
	readCodingAgentMcpReloadFinished,
	readCodingAgentSubagentsObservation,
	readCodingAgentTodoObservation,
} from "@vetta/coding-agent/session-extensions";
import type { SessionEvent } from "@vetta/runtime-core";
import { getDefaultStore, useSetAtom } from "jotai";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import {
	appendError,
	appendTextDelta,
	appendThinkingDelta,
	finalizeMessage,
	finishAssistantTurn,
	getActiveAssistantTurnStartedAt,
	handleToolEnd,
	handleToolPhase,
	handleToolStart,
	nextId,
	startAssistantTurn,
	toChatErrorDetails,
	turnStatsCache,
} from "../services/chat-service";
import { clearCachedContextComposition, writeCachedContextComposition } from "../services/context-composition-cache";
import { ConversationProjection } from "../services/conversation-projection";
import {
	reconcileOptimisticUserMessages,
	rememberOptimisticUserMessage,
} from "../services/optimistic-user-message-cache";
import { diffConsumedQueueEntries } from "../services/queue-mirror";
import { reconcileHistoryWithLiveTerminalErrors } from "../services/terminal-error-reconciliation";
import type { ActiveSessionHandle } from "./session-manager-types";

const DELTA_FLUSH_INTERVAL_MS = 100;

export interface SessionEventController {
	bumpSuggestionToken: (runtimeId: string) => void;
	createSessionEventHandler: (runtimeId: string) => (event: SessionEvent) => void;
	resetEventBuffers: () => void;
}

interface SessionEventControllerOptions {
	activeSessionRef: MutableRefObject<ActiveSessionHandle | null>;
}

function getProjects() {
	return getDefaultStore().get(projectsAtom);
}

export function useSessionEventController({ activeSessionRef }: SessionEventControllerOptions): SessionEventController {
	const setChatMessages = useSetAtom(chatMessagesAtom);
	const setActiveSessionStreaming = useSetAtom(activeSessionStreamingAtom);
	const setRetryProgress = useSetAtom(retryProgressAtom);
	const setLastTurnUsage = useSetAtom(lastTurnUsageAtom);
	const setContextUsage = useSetAtom(contextUsageAtom);
	const setIsCompacting = useSetAtom(isCompactingAtom);
	const setIsReloadingMcp = useSetAtom(isReloadingMcpAtom);
	const setBackgroundTasks = useSetAtom(backgroundTasksBySessionAtom);
	const setSubagents = useSetAtom(subagentsBySessionAtom);
	const setActiveToolNames = useSetAtom(activeToolNamesAtom);
	const setTodoItems = useSetAtom(todoItemsBySessionAtom);
	const setPromptSuggestions = useSetAtom(promptSuggestionsAtom);
	const setPromptPredicting = useSetAtom(promptPredictingAtom);
	const suggestionTokenRef = useRef<Map<string, number>>(new Map());
	const turnStartDispatchSeqRef = useRef<Map<string, number>>(new Map());
	const pendingTextDeltaRef = useRef("");
	const pendingThinkingDeltaRef = useRef("");
	const deltaTimerRef = useRef<number | null>(null);
	const pendingDeltaSessionRef = useRef<string | null>(null);
	const conversationProjectionRef = useRef(new ConversationProjection());

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

	const resetEventBuffers = useCallback(() => {
		if (deltaTimerRef.current !== null) {
			window.clearTimeout(deltaTimerRef.current);
			deltaTimerRef.current = null;
		}
		pendingTextDeltaRef.current = "";
		pendingThinkingDeltaRef.current = "";
		pendingDeltaSessionRef.current = null;
		conversationProjectionRef.current.reset();
	}, []);

	const flushDeltas = useCallback(() => {
		if (deltaTimerRef.current !== null) {
			window.clearTimeout(deltaTimerRef.current);
			deltaTimerRef.current = null;
		}
		const textDelta = pendingTextDeltaRef.current;
		const thinkingDelta = pendingThinkingDeltaRef.current;
		const owningSession = pendingDeltaSessionRef.current;
		const hasAssistantEvents = conversationProjectionRef.current.hasPendingEvents();
		pendingTextDeltaRef.current = "";
		pendingThinkingDeltaRef.current = "";
		pendingDeltaSessionRef.current = null;

		if (owningSession && activeSessionRef.current?.runtimeId !== owningSession) return;
		if (hasAssistantEvents || textDelta || thinkingDelta) {
			setChatMessages((previous) => {
				if (hasAssistantEvents) return conversationProjectionRef.current.flush(previous);
				let next = previous;
				if (thinkingDelta) next = appendThinkingDelta(next, thinkingDelta);
				if (textDelta) next = appendTextDelta(next, textDelta);
				return next;
			});
		}
	}, [activeSessionRef, setChatMessages]);

	const scheduleDeltaFlush = useCallback(() => {
		if (deltaTimerRef.current === null) {
			deltaTimerRef.current = window.setTimeout(flushDeltas, DELTA_FLUSH_INTERVAL_MS);
		}
	}, [flushDeltas]);

	useEffect(() => resetEventBuffers, [resetEventBuffers]);

	const createSessionEventHandler = useCallback(
		(sessionId: string) => (event: SessionEvent) => {
			// Defensive guard: if user has already switched away to another
			// session, drop this event so its delta/state can't bleed into
			// the new session's atom. activeSessionRef is updated synchronously
			// above and reflects the latest user-facing session.
			if (activeSessionRef.current?.runtimeId !== sessionId) return;
			// ── kernel 队列镜像（ADR-0060）──
			// 条目「消失且非本端主动移除」= 已被 turn 消费：此刻补用户气泡，
			// 时序与模型可见顺序严格一致；agent_end 重拉由乐观对账按文本吸收。
			if (event.type === "queue.changed") {
				const queueStore = getDefaultStore();
				const prevQueue = getQueueForSession(queueStore.get(messageQueueBySessionAtom), sessionId);
				const nextQueue: QueuedMessage[] = event.entries.map((entry) => ({
					id: entry.id,
					displayText: entry.displayText,
					behavior: entry.behavior,
				}));
				queueStore.set(setQueueForSessionAtom, { runtimeId: sessionId, items: nextQueue });
				queueStore.set(setQueuePausedAtom, { runtimeId: sessionId, paused: event.paused });
				const consumedEntries = diffConsumedQueueEntries(prevQueue, nextQueue);
				if (consumedEntries.length > 0) {
					// 同一 turn 内接力消费：把上一段流先落定、并切断 assistant 草稿——
					// 否则后续 delta 仍按 draftId 续写进用户气泡**之前**的旧回复气泡里，
					// 第二条回复会显示在它自己的用户消息上方（ADR-0060）。
					flushDeltas();
					conversationProjectionRef.current.reset();
				}
				for (const consumed of consumedEntries) {
					const consumedMsg = createConversationUserMessage({
						id: nextId("user"),
						deliveryPhase: "pending",
						text: consumed.displayText,
						timestamp: Date.now(),
					});
					// 镜像条目只有 displayText（无 attachments/promptRef 元数据），
					// 规范消息回流后按文本吸收即可，避免元数据不等造成气泡残留。
					rememberOptimisticUserMessage(sessionId, consumedMsg, queueStore.get(chatMessagesAtom), {
						matchTextOnly: true,
					});
					setChatMessages((prev) => [...prev, consumedMsg]);
				}
				return;
			}
			// ── Lifecycle ──
			if (event.type === "session.lifecycle") {
				if (event.phase === "agent_start") {
					// 新一轮开始：让上一轮的输入预测生成（若仍在飞）回填时作废。
					bumpSuggestionToken(sessionId);
					// 快照本轮起始时的队列派发序号，供本轮 agent_end 判定重拉是否已过期。
					turnStartDispatchSeqRef.current.set(sessionId, getQueuedDispatchSeq(sessionId));
					conversationProjectionRef.current.reset();
					// agent_start 就建立真实 assistant 草稿：慢模型首包到达前也有稳定消息身份与
					// 绝对 startedAt。无用户消息介入的唤醒仍复用末尾 assistant 气泡。
					setChatMessages((prev) => startAssistantTurn(prev, event.timestamp));
					setActiveSessionStreaming(true);
				}
				if (event.phase === "agent_end" || event.phase === "aborted") {
					// Flush any pending deltas before finalizing
					flushDeltas();
					// Always reset streaming state first to unblock the UI
					const endedAt = event.timestamp;
					const startedAt = getActiveAssistantTurnStartedAt(getDefaultStore().get(chatMessagesAtom));
					const elapsed = startedAt ? (endedAt - startedAt) / 1000 : 0;
					conversationProjectionRef.current.reset();
					setActiveSessionStreaming(false);
					// 重试期也会走到这里（agent_end 先于 retry.start），随后的
					// retry.start 会把进度重新点亮；真正结束时则不会，避免残留。
					setRetryProgress(null);
					// Write total duration onto the last assistant message
					setChatMessages((prev) => finishAssistantTurn(prev, endedAt));

					// Reload full history so user bubbles get session entryId / branch siblings
					// (optimistic messages use synthetic ids and cannot be edited until this).
					void window.vetta.session
						.getFullHistory(sessionId)
						.then((history) => {
							if (activeSessionRef.current?.runtimeId !== sessionId) return;
							// 判活：本轮结束时/后若发生过队列派发（立即发送 / 自然出队），这次整体
							// 替换已「跨到下一轮」——会冲掉下一轮的乐观用户气泡、令 draft 串台，或与
							// 已抢先落盘的 mapped 重复。跳过，交由下一轮自己的 agent_end 安全重拉。
							if (getQueuedDispatchSeq(sessionId) !== (turnStartDispatchSeqRef.current.get(sessionId) ?? 0)) {
								return;
							}
							const mapped = reconcileOptimisticUserMessages(
								sessionId,
								conversationProjectionRef.current.projectHistory(history),
							);
							if (elapsed > 0) {
								for (let i = mapped.length - 1; i >= 0; i--) {
									const message = mapped[i];
									if (message.kind === "agent") {
										mapped[i] = {
											...message,
											startedAt: message.startedAt ?? startedAt,
											endedAt: message.endedAt ?? endedAt,
											durationSeconds: message.durationSeconds ?? elapsed,
										};
										break;
									}
								}
							}
							setChatMessages((liveMessages) => reconcileHistoryWithLiveTerminalErrors(mapped, liveMessages));
						})
						.catch((err) => {
							console.warn("[useSessionManager] getFullHistory after agent_end failed", err);
						});

					if (event.phase === "agent_end") {
						const active = activeSessionRef.current;
						const cwd = active?.cwd;
						const rid = active?.runtimeId;
						const projectType = cwd ? getProjects().find((p) => p.cwd === cwd)?.type : undefined;

						// 输入预测：仅交互式会话（排除批量 / 流转），且开关开启时。每轮
						// 正常完成后基于最近几轮对话异步生成 0-3 条建议，回填时校验过期。
						if (rid && projectType !== "batch") {
							let predictSnapshot: ChatConversationItem[] = [];
							setChatMessages((prev) => {
								predictSnapshot = prev;
								return prev;
							});
							const token = suggestionTokenRef.current.get(rid) ?? 0;
							void (async () => {
								try {
									const cfg = await window.vetta.config.get();
									if (cfg.experimental?.promptPrediction !== true) return;
									const conversation = buildRecentConversation(predictSnapshot);
									if (!conversation) return;
									// 进入「生成中」：末条 assistant 操作栏显示闪光提示。
									markPredicting(rid, true);
									const suggestions = await window.vetta.session.nextPromptSuggestions(rid, conversation);
									// 过期判定：该会话期间已开新轮 / 发新 prompt 则丢弃。
									if ((suggestionTokenRef.current.get(rid) ?? 0) !== token) return;
									setPromptSuggestions((prev) => {
										if (suggestions.length === 0) {
											if (!(rid in prev)) return prev;
											const next = { ...prev };
											delete next[rid];
											return next;
										}
										return { ...prev, [rid]: suggestions };
									});
								} catch (err) {
									console.warn("[useSessionManager] prompt prediction failed", err);
								} finally {
									// 退出「生成中」（成功 / 过期 / 失败均收尾）。
									markPredicting(rid, false);
								}
							})();
						}
					}
				}
				return;
			}

			// ── Raw assistant protocol stream ──
			// AssistantMessageEvent stays intact across Runtime/IPC. The projection
			// batches an ordered event array instead of merging by content type.
			if (event.channel === "assistant") {
				conversationProjectionRef.current.enqueue(event);
				pendingDeltaSessionRef.current = sessionId;
				if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") {
					scheduleDeltaFlush();
				} else {
					flushDeltas();
				}
				return;
			}

			// ── Thinking delta (streaming thinking text) ──
			if (event.type === "thinking.delta") {
				if (conversationProjectionRef.current.hasRawAssistantStream()) return;
				pendingThinkingDeltaRef.current += event.delta;
				pendingDeltaSessionRef.current = sessionId;
				scheduleDeltaFlush();
				return;
			}

			// ── Text delta (streaming assistant text) ──
			if (event.type === "message.delta") {
				if (conversationProjectionRef.current.hasRawAssistantStream()) return;
				pendingTextDeltaRef.current += event.delta;
				pendingDeltaSessionRef.current = sessionId;
				scheduleDeltaFlush();
				return;
			}

			// ── Tool call generating (model started generating a tool call) ──
			if (event.type === "toolcall.start") {
				if (conversationProjectionRef.current.hasRawAssistantStream()) return;
				// Flush pending text/thinking deltas FIRST so the tool block lands
				// after any text that streamed before it (otherwise batched deltas
				// get appended on the wrong side of the tool block).
				flushDeltas();
				setChatMessages((prev) => handleToolStart(prev, event.toolCallId, event.toolName, {}));
				return;
			}

			// ── Message final (full assistant message — text, thinking, tool calls) ──
			if (event.type === "message.final" && event.message.role === "assistant") {
				if (conversationProjectionRef.current.hasRawAssistantStream()) return;
				flushDeltas();
				const { content, usage } = event.message;
				setChatMessages((prev) => finalizeMessage(prev, content, usage));
				return;
			}

			// ── Tool start ──
			if (event.type === "tool.start") {
				flushDeltas();
				setChatMessages((prev) =>
					handleToolStart(
						prev,
						event.toolCallId,
						event.toolName,
						(event.args as Record<string, unknown>) ?? {},
						event.startedAt,
					),
				);
				return;
			}

			// ── Tool phase (live, never persisted into LLM context) ──
			if (event.type === "tool.phase") {
				setChatMessages((prev) => handleToolPhase(prev, event.toolCallId, event.label, event.atMs));
				return;
			}

			// ── Tool end ──
			if (event.type === "tool.end") {
				flushDeltas();
				setChatMessages((prev) =>
					handleToolEnd(prev, event.toolCallId, event.result, event.isError, {
						startedAt: event.startedAt,
						durationMs: event.durationMs,
						phases: event.phases,
					}),
				);
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

			// ── Error (provider / runtime error) ──
			if (event.type === "error") {
				flushDeltas();
				setRetryProgress(null);
				setChatMessages((prev) =>
					appendError(
						prev,
						event.error.message,
						event.retryAttempts,
						event.turnId,
						toChatErrorDetails(event.error),
					),
				);
				return;
			}

			// ── Usage update (emitted per assistant message) ──
			if (event.type === "usage.update") {
				const startedAt = getActiveAssistantTurnStartedAt(getDefaultStore().get(chatMessagesAtom));
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
			flushDeltas,
			markPredicting,
			scheduleDeltaFlush,
			setActiveSessionStreaming,
			setActiveToolNames,
			setBackgroundTasks,
			setChatMessages,
			setContextUsage,
			setIsCompacting,
			setIsReloadingMcp,
			setLastTurnUsage,
			setPromptSuggestions,
			setRetryProgress,
			setSubagents,
			setTodoItems,
		],
	);

	return { bumpSuggestionToken, createSessionEventHandler, resetEventBuffers };
}

function buildRecentConversation(messages: ChatConversationItem[]): string {
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
