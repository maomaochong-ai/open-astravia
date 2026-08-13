import { useProjectActions } from "@domains/project/hooks/useProjects";
import {
	activeSessionStreamingAtom,
	activeToolNamesAtom,
	type BackgroundTask,
	backgroundTasksBySessionAtom,
	type ChatMessage,
	chatMessagesAtom,
	contextUsageAtom,
	conversationBucketCwd,
	defaultConversationCwdAtom,
	isCompactingAtom,
	isReloadingMcpAtom,
	lastTurnUsageAtom,
	projectsAtom,
	promptPredictingAtom,
	promptSuggestionsAtom,
	retryProgressAtom,
	type SubagentTask,
	subagentsBySessionAtom,
	type TodoItem,
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
import type { SessionEvent } from "@vetta/runtime-core";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import {
	adoptDraftId,
	appendError,
	appendTextDelta,
	appendThinkingDelta,
	finalizeMessage,
	fullHistoryToChat,
	handleToolEnd,
	handleToolPhase,
	handleToolStart,
	nextId,
	resetStreamState,
	setTurnStartTime,
	turnStartTime,
	turnStatsCache,
} from "../services/chat-service";
import { writeCachedContextComposition } from "../services/context-composition-cache";
import {
	reconcileOptimisticUserMessages,
	rememberOptimisticUserMessage,
} from "../services/optimistic-user-message-cache";
import { diffConsumedQueueEntries } from "../services/queue-mirror";
import type { ActiveSessionHandle } from "./session-manager-types";

const DELTA_FLUSH_INTERVAL_MS = 100;

export interface SessionEventController {
	bumpSuggestionToken: (runtimeId: string) => void;
	createSessionEventHandler: (runtimeId: string) => (event: SessionEvent) => void;
	markAutoTitleHandled: (sessionPath: string) => void;
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
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const { applyLocalRename, loadSessions } = useProjectActions();

	const defaultConversationCwdRef = useRef(defaultConversationCwd);
	defaultConversationCwdRef.current = defaultConversationCwd;
	const autoTitledSessionsRef = useRef<Set<string>>(new Set());
	const suggestionTokenRef = useRef<Map<string, number>>(new Map());
	const turnStartDispatchSeqRef = useRef<Map<string, number>>(new Map());
	const pendingTextDeltaRef = useRef("");
	const pendingThinkingDeltaRef = useRef("");
	const deltaTimerRef = useRef<number | null>(null);
	const pendingDeltaSessionRef = useRef<string | null>(null);

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
	}, []);

	const flushDeltas = useCallback(() => {
		if (deltaTimerRef.current !== null) {
			window.clearTimeout(deltaTimerRef.current);
			deltaTimerRef.current = null;
		}
		const textDelta = pendingTextDeltaRef.current;
		const thinkingDelta = pendingThinkingDeltaRef.current;
		const owningSession = pendingDeltaSessionRef.current;
		pendingTextDeltaRef.current = "";
		pendingThinkingDeltaRef.current = "";
		pendingDeltaSessionRef.current = null;

		if (owningSession && activeSessionRef.current?.runtimeId !== owningSession) return;
		if (textDelta || thinkingDelta) {
			setChatMessages((previous) => {
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

	const markAutoTitleHandled = useCallback((sessionPath: string) => {
		autoTitledSessionsRef.current.add(sessionPath);
	}, []);

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
					resetStreamState();
				}
				for (const consumed of consumedEntries) {
					const consumedMsg: ChatMessage = {
						id: nextId("user"),
						role: "user",
						text: consumed.displayText,
						timestamp: Date.now(),
					};
					rememberOptimisticUserMessage(sessionId, consumedMsg, queueStore.get(chatMessagesAtom));
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
					resetStreamState();
					// 无用户消息介入的唤醒（如后台任务 <task-notification> 触发的新
					// turn）延续上一个 assistant 气泡，而不是新开一条——与重载时
					// fullHistoryToChat 合并连续 assistant 消息的行为保持一致。
					setChatMessages((prev) => {
						const last = prev.at(-1);
						if (last?.role === "assistant") {
							adoptDraftId(last.id);
						}
						return prev;
					});
					setTurnStartTime(event.timestamp);
					setActiveSessionStreaming(true);
				}
				if (event.phase === "agent_end" || event.phase === "aborted") {
					// Flush any pending deltas before finalizing
					flushDeltas();
					// Always reset streaming state first to unblock the UI
					const endedAt = event.timestamp;
					const startedAt = turnStartTime;
					const elapsed = startedAt ? (endedAt - startedAt) / 1000 : 0;
					resetStreamState();
					setActiveSessionStreaming(false);
					setTurnStartTime(0);
					// 重试期也会走到这里（agent_end 先于 retry.start），随后的
					// retry.start 会把进度重新点亮；真正结束时则不会，避免残留。
					setRetryProgress(null);
					// Write total duration onto the last assistant message
					setChatMessages((prev) => {
						if (elapsed > 0) {
							for (let i = prev.length - 1; i >= 0; i--) {
								if (prev[i].role === "assistant") {
									const copy = [...prev];
									copy[i] = {
										...copy[i],
										startedAt: copy[i].startedAt ?? startedAt,
										endedAt,
										durationSeconds: elapsed,
									};
									return copy;
								}
							}
						}
						return prev;
					});

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
							const mapped = reconcileOptimisticUserMessages(sessionId, fullHistoryToChat(history));
							if (elapsed > 0) {
								for (let i = mapped.length - 1; i >= 0; i--) {
									if (mapped[i].role === "assistant") {
										mapped[i] = {
											...mapped[i],
											startedAt: mapped[i].startedAt ?? startedAt,
											endedAt: mapped[i].endedAt ?? endedAt,
											durationSeconds: mapped[i].durationSeconds ?? elapsed,
										};
										break;
									}
								}
							}
							setChatMessages(mapped);
						})
						.catch((err) => {
							console.warn("[useSessionManager] getFullHistory after agent_end failed", err);
						});

					// First-round auto title: trigger only on successful agent_end of
					// a brand-new session, exactly once per sessionPath.
					if (event.phase === "agent_end") {
						const active = activeSessionRef.current;
						const sp = active?.sessionPath;
						const cwd = active?.cwd;
						const rid = active?.runtimeId;
						// Skip auto-title for batch-task projects entirely — those sessions
						// are driven by the batch executor and should keep their batch-managed
						// names (or default firstMessage label).
						const projectType = cwd ? getProjects().find((p) => p.cwd === cwd)?.type : undefined;
						if (sp && cwd && rid && projectType !== "batch" && !autoTitledSessionsRef.current.has(sp)) {
							autoTitledSessionsRef.current.add(sp);
							// Snapshot current chat messages via a no-op updater, then run
							// the LLM call asynchronously without blocking the UI.
							let snapshot: ChatMessage[] = [];
							setChatMessages((prev) => {
								snapshot = prev;
								return prev;
							});
							void (async () => {
								const firstUser = snapshot.find((m) => m.role === "user");
								let lastAssistant: ChatMessage | undefined;
								for (let i = snapshot.length - 1; i >= 0; i--) {
									if (snapshot[i].role === "assistant") {
										lastAssistant = snapshot[i];
										break;
									}
								}
								if (!firstUser || !lastAssistant) {
									autoTitledSessionsRef.current.delete(sp);
									return;
								}
								const userText = firstUser.text ?? "";
								const assistantText = lastAssistant.text ?? "";
								if (!userText.trim() && !assistantText.trim()) {
									autoTitledSessionsRef.current.delete(sp);
									return;
								}
								try {
									const titleStartedAt = Date.now();
									console.log(`[auto-title] requesting for session=${rid} sp=${sp}`);
									const name = await window.vetta.session.autoTitle(rid, userText, assistantText);
									const durationMs = Date.now() - titleStartedAt;
									console.log(
										`[auto-title] got name=${name ?? "(null)"} durationMs=${durationMs} for sp=${sp}`,
									);
									if (name) {
										// 归一到侧边栏 bucket 的 cwd：「对话」session 的 cwd 是项目根下的
										// per-session 子目录（ADR-0007），但 sessionsMap / 侧边栏挂在根上。
										const bucketCwd = conversationBucketCwd(cwd, defaultConversationCwdRef.current);
										// Optimistic local update for sessions already present in the map.
										applyLocalRename(bucketCwd, sp, name);
										// Re-read from disk: handles brand-new sessions whose JSONL only
										// just appeared after the assistant's first message flushed, and
										// guarantees the persisted name is reflected in the sidebar.
										await loadSessions(bucketCwd);
									} else {
										autoTitledSessionsRef.current.delete(sp);
									}
								} catch (err) {
									console.warn("[useSessionManager] auto-title failed", err);
									autoTitledSessionsRef.current.delete(sp);
								}
							})();
						}

						// 输入预测：仅交互式会话（排除批量 / 流转），且开关开启时。每轮
						// 正常完成后基于最近几轮对话异步生成 0-3 条建议，回填时校验过期。
						if (rid && projectType !== "batch") {
							let predictSnapshot: ChatMessage[] = [];
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

			// ── Thinking delta (streaming thinking text) ──
			if (event.type === "thinking.delta") {
				pendingThinkingDeltaRef.current += event.delta;
				pendingDeltaSessionRef.current = sessionId;
				scheduleDeltaFlush();
				return;
			}

			// ── Text delta (streaming assistant text) ──
			if (event.type === "message.delta") {
				pendingTextDeltaRef.current += event.delta;
				pendingDeltaSessionRef.current = sessionId;
				scheduleDeltaFlush();
				return;
			}

			// ── Tool call generating (model started generating a tool call) ──
			if (event.type === "toolcall.start") {
				// Flush pending text/thinking deltas FIRST so the tool block lands
				// after any text that streamed before it (otherwise batched deltas
				// get appended on the wrong side of the tool block).
				flushDeltas();
				setChatMessages((prev) => handleToolStart(prev, event.toolCallId, event.toolName, {}));
				return;
			}

			// ── Message final (full assistant message — text, thinking, tool calls) ──
			if (event.type === "message.final" && event.message.role === "assistant") {
				flushDeltas();
				setChatMessages((prev) => finalizeMessage(prev, event.message.content));
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
				setChatMessages((prev) => appendError(prev, event.error.message, event.retryAttempts));
				return;
			}

			// ── Usage update (emitted per assistant message) ──
			if (event.type === "usage.update") {
				const elapsed = turnStartTime ? (Date.now() - turnStartTime) / 1000 : 0;
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
				return;
			}

			// ── MCP lazy reload (on prompt) ──
			if (event.type === "mcp.reload.start") {
				setIsReloadingMcp(true);
				return;
			}
			if (event.type === "mcp.reload.end") {
				setIsReloadingMcp(false);
				return;
			}

			// ── Background tasks update (run_in_background) ──
			if (event.type === "background_tasks_update") {
				const sid = activeSessionRef.current?.runtimeId;
				if (sid) {
					const tasks = ((event as { tasks?: unknown[] }).tasks ?? []) as BackgroundTask[];
					setBackgroundTasks((prev) => {
						const next = new Map(prev);
						if (tasks.length > 0) {
							next.set(sid, tasks);
						} else {
							next.delete(sid);
						}
						return next;
					});
				}
				return;
			}

			// ── Subagents update (explorer children, etc.) ──
			if (event.type === "subagents_update") {
				const sid = activeSessionRef.current?.runtimeId;
				if (sid) {
					const agents = ((event as { agents?: unknown[] }).agents ?? []) as SubagentTask[];
					setSubagents((prev) => {
						const next = new Map(prev);
						if (agents.length > 0) {
							next.set(sid, agents);
						} else {
							next.delete(sid);
						}
						return next;
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

			// ── Todo update ──
			if (event.type === "todo_update") {
				const sid = activeSessionRef.current?.runtimeId;
				if (sid) {
					const items = (event as { items?: unknown[] }).items ?? [];
					setTodoItems((prev) => {
						const next = new Map(prev);
						if (items.length > 0) {
							next.set(sid, items as TodoItem[]);
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
			applyLocalRename,
			bumpSuggestionToken,
			flushDeltas,
			loadSessions,
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

	return { bumpSuggestionToken, createSessionEventHandler, markAutoTitleHandled, resetEventBuffers };
}

function buildRecentConversation(messages: ChatMessage[]): string {
	const relevant = messages.filter((message) => message.role === "user" || message.role === "assistant");
	let startIndex = relevant.length;
	let userCount = 0;
	for (let index = relevant.length - 1; index >= 0; index--) {
		if (relevant[index].role === "user") {
			userCount++;
			startIndex = index;
			if (userCount >= 3) break;
		}
	}
	const lines: string[] = [];
	for (const message of relevant.slice(startIndex)) {
		const text = (message.text ?? "").trim();
		if (!text) continue;
		lines.push(`${message.role === "user" ? "User" : "Assistant"}: ${text.slice(0, 600)}`);
	}
	return lines.join("\n\n").slice(0, 4000);
}
