import { waitForPluginHostReady } from "@domains/plugins/runtime/plugin-events";
import { pluginSendMessageRef } from "@domains/plugins/runtime/plugin-host-bridge";
import { useProjectActions } from "@domains/project/hooks/useProjects";
import { i18n } from "@shared/i18n";
import {
	BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID,
	recordInputActionsUsed,
	recordInputContextUsed,
} from "@shared/lib/app-monitor-events";
import { deriveSkillNames, parseInputSegments } from "@shared/lib/input-tokens";
import {
	activeInputActionIdsAtom,
	activeSessionAtom,
	activeSessionStreamingAtom,
	activeToolNamesAtom,
	adoptExistingSessionInputDraft,
	appshotAttachmentAtom,
	attachedImagesAtom,
	type BackgroundTask,
	backgroundTasksBySessionAtom,
	batchProjectsAtom,
	type ChatMessage,
	chatMessagesAtom,
	claimNewSessionInputDraft,
	contextUsageAtom,
	conversationBucketCwd,
	currentScenarioAtom,
	defaultConversationCwdAtom,
	inlineFilePreviewAtom,
	inputValueAtom,
	isCompactingAtom,
	isReloadingMcpAtom,
	isStreamingAtom,
	knowledgeRetrievalActiveAtom,
	lastActiveSessionAtom,
	lastTurnUsageAtom,
	mentionedFilesAtom,
	modelSupportsImagesAtom,
	newSessionInputDraftKey,
	openSessionFnRef,
	type Project,
	pendingMessageEditAtom,
	pluginInputActionsAtom,
	projectsAtom,
	promptAttachmentAtom,
	promptPredictingAtom,
	promptSuggestionsAtom,
	reasoningByModelAtom,
	recordSentInputAndClearDraft,
	retryProgressAtom,
	type SessionExecutionMode,
	type SubagentTask,
	selectedModelAtom,
	selectedSkillAtom,
	sendMessageFnRef,
	sessionExecutionModeAtom,
	sessionsMapAtom,
	subagentsBySessionAtom,
	type TodoItem,
	todoItemsBySessionAtom,
} from "@shared/store/atoms";
import {
	bumpQueuedDispatchSeq,
	enqueueMessageAtom,
	getQueuedDispatchSeq,
	getQueueForSession,
	messageQueueBySessionAtom,
	removeQueuedMessageAtom,
} from "@shared/store/message-queue-atoms";
import { useNavigate } from "@tanstack/react-router";
import type { ConversationScenario, PluginPromptContext } from "@vetta-org/plugin-sdk";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import type { PromptAttachmentRef, PromptRequest } from "../../../../../../runtime-core/src/index.js";
import {
	adoptDraftId,
	appendError,
	appendTextDelta,
	appendThinkingDelta,
	bumpOpenSessionToken,
	currentUnsubscribe,
	finalizeMessage,
	fullHistoryToChat,
	getOpenSessionToken,
	handleToolEnd,
	handleToolPhase,
	handleToolStart,
	isUserImageFile,
	nextId,
	resetStreamState,
	setCurrentUnsubscribe,
	setTurnStartTime,
	turnStartTime,
	turnStatsCache,
} from "../services/chat-service";

/** 把 "provider/id" 形式的 modelKey 解析为 ChatMessage.model 结构 */
function modelKeyToParts(key: string | null | undefined): { provider: string; id: string } | undefined {
	if (!key) return undefined;
	const idx = key.indexOf("/");
	if (idx <= 0) return undefined;
	return { provider: key.slice(0, idx), id: key.slice(idx + 1) };
}

interface SessionManagerResult {
	openSession: (
		cwd: string,
		sessionPath?: string,
		executionMode?: SessionExecutionMode,
		options?: { navigate?: boolean },
	) => Promise<void>;
	/**
	 * overrideText：以指定文本作为独立 prompt 直发（输入预测建议 / 设置 AI 协助等），省略则按输入框内容发送。
	 * options.metadata：合并进本轮 PromptRequest.metadata（仅宿主/input-pipeline 消费，不进用户气泡正文）。
	 * options.settingsAssistTabId：乐观用户气泡打上页面对应标签（如「MCP配置协助」）。
	 */
	sendMessage: (
		overrideText?: string,
		options?: { metadata?: Record<string, unknown>; settingsAssistTabId?: string },
	) => Promise<void>;
	abortMessage: () => Promise<void>;
	/** 立即发送某条排队消息：streaming 时先中止当前流、等 aborted 再发，空闲则直发。 */
	sendQueuedNow: (runtimeId: string, id: string) => Promise<void>;
	openSessionRef: React.MutableRefObject<
		| ((
				cwd: string,
				sessionPath?: string,
				executionMode?: SessionExecutionMode,
				options?: { navigate?: boolean },
		  ) => Promise<void>)
		| undefined
	>;
}

/**
 * projects 只在回调里按 cwd 反查类型。订阅 projectsAtom 会让项目列表每次刷新都把整个
 * 会话管理器（以及它所在的 RootLayout 子树，含侧栏）重渲染，这里改成调用时现读。
 */
function getProjects(): Project[] {
	return getDefaultStore().get(projectsAtom);
}

/** 流式 delta 的冲刷节流间隔；下游文字揭示是 500ms 批的，这里不需要更快。 */
const DELTA_FLUSH_INTERVAL_MS = 100;

export function useSessionManager(): SessionManagerResult {
	const [activeSession, setActiveSession] = useAtom(activeSessionAtom);
	const setChatMessages = useSetAtom(chatMessagesAtom);
	const setActiveSessionStreaming = useSetAtom(activeSessionStreamingAtom);
	const [attachedImages, setAttachedImages] = useAtom(attachedImagesAtom);
	const selectedSkill = useAtomValue(selectedSkillAtom);
	const [mentionedFiles, setMentionedFiles] = useAtom(mentionedFilesAtom);
	const appshotAttachment = useAtomValue(appshotAttachmentAtom);
	// 发送时直接读取输入 atom 快照，避免 useSessionManager 订阅每次按键。
	// 这个 hook 同时挂在根布局和页面中；订阅会让这些宿主随输入重渲染整棵子树。
	const attachedImagesRef = useRef(attachedImages);
	attachedImagesRef.current = attachedImages;
	const selectedSkillRef = useRef(selectedSkill);
	selectedSkillRef.current = selectedSkill;
	const mentionedFilesRef = useRef(mentionedFiles);
	mentionedFilesRef.current = mentionedFiles;
	const appshotRef = useRef(appshotAttachment);
	appshotRef.current = appshotAttachment;
	const navigate = useNavigate();
	const setLastTurnUsage = useSetAtom(lastTurnUsageAtom);
	const setLastActiveSession = useSetAtom(lastActiveSessionAtom);
	const setContextUsage = useSetAtom(contextUsageAtom);
	const [selectedModel, setSelectedModel] = useAtom(selectedModelAtom);
	const selectedModelRef = useRef(selectedModel);
	selectedModelRef.current = selectedModel;
	const setModelSupportsImages = useSetAtom(modelSupportsImagesAtom);
	const setSessionExecutionMode = useSetAtom(sessionExecutionModeAtom);
	const setActiveToolNames = useSetAtom(activeToolNamesAtom);
	const setCurrentScenario = useSetAtom(currentScenarioAtom);
	const setTodoItems = useSetAtom(todoItemsBySessionAtom);
	const setBackgroundTasks = useSetAtom(backgroundTasksBySessionAtom);
	const setSubagents = useSetAtom(subagentsBySessionAtom);
	// sendMessage 需要读「当前 session 的 todo 状态」决定是否在下一个 prompt 前清空。
	// 用 ref 镜像，避免在 useCallback 闭包里拿到旧值或让 sendMessage 依赖 atom 频繁变化。
	const todoItemsMap = useAtomValue(todoItemsBySessionAtom);
	const todoItemsMapRef = useRef(todoItemsMap);
	todoItemsMapRef.current = todoItemsMap;
	const setIsCompacting = useSetAtom(isCompactingAtom);
	const setRetryProgress = useSetAtom(retryProgressAtom);
	const setIsReloadingMcp = useSetAtom(isReloadingMcpAtom);
	const setInlineFilePreview = useSetAtom(inlineFilePreviewAtom);
	// 用于判断当前 session 是否归属一个 paused 的 batch-task 子任务。命中时
	// sendMessage 改走 batchTasks.resumeTaskWithText 入队首恢复运行，而不是
	// 直接 session.prompt 立即 streaming（与并发上限共生）。
	const batchProjects = useAtomValue(batchProjectsAtom);
	const batchProjectsRef = useRef(batchProjects);
	batchProjectsRef.current = batchProjects;
	const { loadSessions, applyLocalRename, ensureLocalSession } = useProjectActions();
	// ADR-0007：「对话」session 运行 cwd 是项目根下的 per-session 子目录，但其 jsonl 与
	// 侧边栏 sessionsMap bucket 都挂在项目根 cwd 上。重命名/刷新必须落到「根」bucket，
	// 否则侧边栏与顶部标题读不到更新。用此 ref 把子目录 cwd 归一回项目根。
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const defaultConversationCwdRef = useRef(defaultConversationCwd);
	defaultConversationCwdRef.current = defaultConversationCwd;
	const activeSessionRef = useRef<{ cwd: string; sessionPath: string; runtimeId: string } | null>(null);
	const openSessionRef = useRef<
		| ((
				cwd: string,
				sessionPath?: string,
				executionMode?: SessionExecutionMode,
				options?: { navigate?: boolean },
		  ) => Promise<void>)
		| undefined
	>(undefined);
	// Sessions for which auto-title has already been attempted (or skipped because
	// the session was opened with prior history / already had a name).
	const autoTitledSessionsRef = useRef<Set<string>>(new Set());
	const setPromptSuggestions = useSetAtom(promptSuggestionsAtom);
	const setPromptPredicting = useSetAtom(promptPredictingAtom);
	const markPredicting = useCallback(
		(rid: string, predicting: boolean) => {
			setPromptPredicting((prev) => {
				if (predicting) return { ...prev, [rid]: true };
				if (!(rid in prev)) return prev;
				const next = { ...prev };
				delete next[rid];
				return next;
			});
		},
		[setPromptPredicting],
	);
	// 输入预测的「过期判定」令牌：按 runtimeId 计数，每次该会话开新一轮
	// （agent_start）或用户发新 prompt（sendMessage）时 +1。生成在 agent_end
	// 触发时捕获当时的令牌，异步回填时若令牌已变则丢弃过期结果。
	const suggestionTokenRef = useRef<Map<string, number>>(new Map());
	const bumpSuggestionToken = useCallback((rid: string) => {
		const map = suggestionTokenRef.current;
		map.set(rid, (map.get(rid) ?? 0) + 1);
	}, []);
	// 每轮 agent_start 记录当时的「队列派发序号」快照；该轮 agent_end 的整体历史重拉落地时
	// 若序号已变（结束时/后发生过队列派发，重拉已跨到下一轮）则跳过，避免冲掉下一轮的乐观
	// 气泡 / 令 draft 串台。交由下一轮自己在无重叠时安全重拉。
	const turnStartDispatchSeqRef = useRef<Map<string, number>>(new Map());

	// ── Delta batching: accumulate text/thinking deltas, flush on a throttle timer ──
	// 原来按 rAF 冲刷（≈60 次/秒 setChatMessages）。但文字的视觉呈现在下游
	// TextBlockView 是按 500ms 批量揭示的，60fps 的冲刷对画面毫无贡献，只是让
	// 尾部消息整条重渲染（groupBlocks / 折叠计算 / Virtuoso 重测）每秒白跑 60 遍，
	// 流式期间 Renderer CPU 的大头就在这。降到 100ms 一次，视觉零差别。
	// 工具/状态事件前的同步 flushDeltas() 路径保持不变——顺序保证不受影响。
	const pendingTextDeltaRef = useRef("");
	const pendingThinkingDeltaRef = useRef("");
	const deltaRafRef = useRef<number | null>(null);
	// Tracks which session the currently-pending deltas belong to. If the user
	// switches away before the next rAF fires, we drop the deltas instead of
	// appending them to the new session's messages.
	const pendingDeltaSessionRef = useRef<string | null>(null);

	// Idempotent flush: safe to call from rAF callback OR synchronously before any
	// non-delta event handler. Always cancels any pending rAF before draining.
	// Calling this before a tool/state event is what keeps streamed text on the
	// correct side of tool blocks — see ordering bug fix.
	const flushDeltas = useCallback(() => {
		if (deltaRafRef.current !== null) {
			window.clearTimeout(deltaRafRef.current);
			deltaRafRef.current = null;
		}
		const textDelta = pendingTextDeltaRef.current;
		const thinkingDelta = pendingThinkingDeltaRef.current;
		const owningSession = pendingDeltaSessionRef.current;
		pendingTextDeltaRef.current = "";
		pendingThinkingDeltaRef.current = "";
		pendingDeltaSessionRef.current = null;

		if (owningSession && activeSessionRef.current?.runtimeId !== owningSession) {
			return;
		}

		if (textDelta || thinkingDelta) {
			setChatMessages((prev) => {
				let next = prev;
				if (thinkingDelta) next = appendThinkingDelta(next, thinkingDelta);
				if (textDelta) next = appendTextDelta(next, textDelta);
				return next;
			});
		}
	}, [setChatMessages]);

	const scheduleDeltaFlush = useCallback(() => {
		if (deltaRafRef.current === null) {
			deltaRafRef.current = window.setTimeout(flushDeltas, DELTA_FLUSH_INTERVAL_MS);
		}
	}, [flushDeltas]);

	// Cleanup pending flush timer on unmount
	useEffect(() => {
		return () => {
			if (deltaRafRef.current !== null) {
				window.clearTimeout(deltaRafRef.current);
			}
		};
	}, []);

	const openSession = useCallback(
		async (
			cwd: string,
			sessionPath?: string,
			executionMode?: SessionExecutionMode,
			options?: { navigate?: boolean },
		) => {
			// 取自己的调用令牌；若中途被新的 openSession 抢跑，会在 subscribe()
			// 返回后被发现并立即清理自己刚建好的 IPC 订阅，避免泄漏。
			const myOpenToken = bumpOpenSessionToken();
			const shouldNavigate = options?.navigate !== false;
			// 切换 session 前清掉内嵌文件预览（指向旧 cwd 的某个具体文件），但
			// **保留**活动面板的展开状态：用户在上一个 session 打开过 ActivityPanel
			// 后，切到新 session 仍维持打开，避免每次切换都要重新点开。
			// ActivityPanel 内部以 cwd 为 key remount，新 session 的数据会重拉。
			setInlineFilePreview(null);
			// Teardown previous session
			currentUnsubscribe?.();
			setCurrentUnsubscribe(null);
			// Cancel any in-flight flush timer and drop pending deltas — otherwise the
			// prior session's accumulated delta text gets flushed into the new session's atom.
			if (deltaRafRef.current !== null) {
				window.clearTimeout(deltaRafRef.current);
				deltaRafRef.current = null;
			}
			pendingTextDeltaRef.current = "";
			pendingThinkingDeltaRef.current = "";
			pendingDeltaSessionRef.current = null;
			resetStreamState();
			// 切会话时清掉本地 streaming 信号；若新会话仍在跑，下面 state.isStreaming
			// 分支 + runningSessionPathsAtom 派生兜底会把 TypingIndicator 重新拉回来。
			setActiveSessionStreaming(false);
			setIsCompacting(false);
			setRetryProgress(null);
			// Clear messages immediately so the user sees the switch take effect
			// instead of staring at the old session while history loads.
			setChatMessages([]);
			getDefaultStore().set(pendingMessageEditAtom, null);
			// 切会话先把激活工具集置未知（null）→ badge 回退显示，等 getState 回填真实集合。
			setActiveToolNames(null);
			// 场景同样置未知（null）→ 插件插槽 fail-closed 暂不显示，等 getState 回填后按场景显隐。
			setCurrentScenario(null);

			const isBatchSession =
				sessionPath !== undefined &&
				batchProjectsRef.current.some((project) => project.tasks.some((task) => task.sessionPath === sessionPath));
			const isBatchProject = batchProjectsRef.current.some((project) => project.id === cwd);
			const projectType = getProjects().find((project) => project.cwd === cwd)?.type;
			const sessionKind = isBatchSession || isBatchProject || projectType === "batch" ? "other" : "conversation";
			// 对话场景显式下发（不依赖 sessionKind，避免改 kind 牵动 VETTA_CLI/子目录等行为）：
			// - 批量 → "batch"（与 batch-task-executor 一致，重开不退化成 project，输入栏 badge 不复活）。
			// - 默认「对话」项目（cwd 归一到 defaultConversationCwd）→ "conversation"。
			// - 其余交互式项目 → "project"。此前普通项目被 sessionKind="conversation" 误标成
			//   "conversation"，导致 scope_use:["project"] 的工具/插件插槽永不命中。
			const defaultCwd = defaultConversationCwdRef.current;
			const isDefaultConversation = !!defaultCwd && conversationBucketCwd(cwd, defaultCwd) === defaultCwd;
			const scenario: ConversationScenario =
				isBatchSession || isBatchProject || projectType === "batch"
					? "batch"
					: isDefaultConversation
						? "conversation"
						: "project";
			const createResult = await window.vetta.session.create(
				{ cwd, sessionPath, executionMode, scenario },
				sessionKind,
			);
			const { sessionId } = createResult;
			// ADR-0007: 「对话」项目下 main 会把 cwd 改写成 per-session 子目录，
			// 这里以 main 返回的 effective cwd 为准，保证 FilesPanel/调试 cwd 都指向子目录。
			const effectiveCwd = createResult.cwd ?? cwd;

			// 拿到 sessionId 就立即写 activeSession；默认再 navigate 到 ChatView。
			// 真实 sessionPath 解析（可能还要再走一次 IPC）放到后面，等好了再补一次写入。
			// 这样 Welcome → Chat 的转场就不会被 getFullHistory / getState / getSessionPath
			// 的串行 IPC 拖住，体感保持瞬时。
			// navigate:false：设置页 AI 协助等场景只后台建会话，留在当前路由，由侧栏高亮 + 飞球引导。
			const earlySessionInfo = { cwd: effectiveCwd, sessionPath: sessionPath ?? "", runtimeId: sessionId };
			setActiveSession(earlySessionInfo);
			activeSessionRef.current = earlySessionInfo;
			if (shouldNavigate) {
				void navigate({ to: "/" });
			}

			// Fire history + state in parallel so renderer doesn't wait on two
			// sequential IPC round-trips. History is rendered as soon as it lands;
			// state arrives shortly after and fills in context/streaming UI.
			const historyPromise = window.vetta.session.getFullHistory(sessionId);
			const statePromise = window.vetta.session.getState(sessionId);

			const history = await historyPromise;
			const mapped = fullHistoryToChat(history);
			setChatMessages(mapped);

			// If this session already has any prior turn (loaded from disk) we never
			// want to auto-rename — only brand-new sessions on their first round.
			if (sessionPath && mapped.some((m) => m.role === "user")) {
				autoTitledSessionsRef.current.add(sessionPath);
			}

			const state = await statePromise;
			setContextUsage({
				percent: state.contextPercent,
				contextWindow: state.contextWindow,
			});
			setModelSupportsImages(state.model?.input?.includes("image") ?? false);
			setSessionExecutionMode(state.executionMode);
			// 激活工具集 → 输入栏 badge 按工具 scope 跟随显示（单一真相源）。
			setActiveToolNames(new Set(state.activeToolNames));
			// 对话场景 → 会话页插件插槽按对话类型 fail-closed 显隐。
			setCurrentScenario(state.scenario);
			// Fork lineage from session header (parentSession / parentEntryId).
			const parentSessionPath = state.parentSessionPath;
			const parentEntryId = state.parentEntryId;

			// 打开「已有」会话（sessionPath 有值）：真相源为后端会话 settings，把后端模型 pull
			// 到前端镜像，避免用全局 atom 的旧值 push 覆盖本会话（会污染其它会话已选的模型）。
			// 「新建」会话（sessionPath 为 undefined，如欢迎页/快捷面板）：后端刚建出的会话用的是
			// 默认模型，而前端 selectedModel 才是用户刚在欢迎页选好的真相源。此时若 pull 回填会把
			// 用户的选择覆盖成默认模型（显示与本轮实际发送的模型不一致），所以反过来把前端选择
			// push 到后端会话 settings，两端保持一致。
			const backendModelKey = state.model ? `${state.model.provider}/${state.model.id}` : null;
			if (sessionPath === undefined) {
				const desired = selectedModelRef.current;
				if (desired && desired !== backendModelKey) {
					void window.vetta.session.updateSettings(sessionId, { modelKey: desired });
				}
			} else if (backendModelKey) {
				setSelectedModel(backendModelKey);
			}

			// Resolve the on-disk session path so that downstream features (turn
			// stats cache, auto-title rename) can key off the actual file path even
			// for sessions that were just created by the runtime.
			const resolvedSessionPath = sessionPath ?? (await window.vetta.session.getSessionPath(sessionId)) ?? "";
			const cachedKey = resolvedSessionPath;
			setLastTurnUsage(turnStatsCache.get(cachedKey) ?? null);

			// If session is still streaming, adopt the last history assistant message as draft
			// so that incoming streaming events append to it instead of creating a duplicate.
			// IMPORTANT: only adopt an assistant message that appears AFTER the latest user
			// message. Otherwise the still-streaming turn (whose assistant content is not yet
			// persisted to disk) would be appended to the previous turn's assistant — which
			// sits BEFORE the new user message in history, causing the streaming bubble to
			// render above the user bubble.
			if (state.isStreaming) {
				const startedAt = state.currentTurnStartedAt ?? Date.now();
				let adoptedId: string | null = null;
				let lastUserIdx = -1;
				for (let i = mapped.length - 1; i >= 0; i--) {
					if (mapped[i].role === "user") {
						lastUserIdx = i;
						break;
					}
				}
				for (let i = mapped.length - 1; i > lastUserIdx; i--) {
					if (mapped[i].role === "assistant") {
						adoptDraftId(mapped[i].id);
						adoptedId = mapped[i].id;
						break;
					}
				}
				if (adoptedId) {
					setChatMessages((prev) =>
						prev.map((message) =>
							message.id === adoptedId
								? {
										...message,
										startedAt,
										timestamp: message.timestamp ?? startedAt,
										// History rebuild (messageToBlocks) defaults tool_call status to
										// "success". For the still-streaming turn, calls without a result
										// are actually in-flight — restore "pending" so in-progress UI (e.g.
										// the image-gen 处理中 skeleton) survives a session switch instead of
										// vanishing while the tool keeps running in the background.
										blocks: message.blocks?.map((b) =>
											b.type === "tool_call" && b.result === undefined
												? { ...b, status: "pending" as const }
												: b,
										),
									}
								: message,
						),
					);
				}
				setActiveSessionStreaming(true);
				setTurnStartTime(startedAt);
			}

			// 补一次写入：真实 sessionPath + fork 血缘（parentSession/parentEntryId）。
			// 早写入用的是 sessionPath ?? "" 且无 lineage；state 落地后统一覆写。
			{
				const sessionInfo = {
					cwd: effectiveCwd,
					sessionPath: cachedKey,
					runtimeId: sessionId,
					parentSessionPath,
					parentEntryId,
				};
				setActiveSession(sessionInfo);
				activeSessionRef.current = sessionInfo;
			}

			// 输入草稿按 sessionPath 隔离：打开已有会话装入该会话草稿；
			// 新建会话保留工作集（随即 sendMessage），只把归属从 new:cwd 迁到真实 path。
			if (sessionPath === undefined) {
				claimNewSessionInputDraft(cachedKey, newSessionInputDraftKey(cwd));
			} else {
				adoptExistingSessionInputDraft(cachedKey);
			}

			// ─── Subscribe to live session events ───
			const unsubscribeFn = await window.vetta.session.subscribe(sessionId, (event) => {
				// Defensive guard: if user has already switched away to another
				// session, drop this event so its delta/state can't bleed into
				// the new session's atom. activeSessionRef is updated synchronously
				// above and reflects the latest user-facing session.
				if (activeSessionRef.current?.runtimeId !== sessionId) return;
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
								const mapped = fullHistoryToChat(history);
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
					setRetryProgress({ attempt: event.attempt, maxAttempts: event.maxAttempts });
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
					setContextUsage({
						percent: event.contextPercent ?? null,
						contextWindow: event.contextWindow ?? 0,
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
			});

			// 校验令牌：如果 await 期间用户已经切换到下一个 session，本次的
			// subscribe 已经成了孤儿——立刻 unsub，绝不要写进 currentUnsubscribe，
			// 否则它会覆盖后来者，新订阅永不被清理；而每个泄漏的订阅都会在 preload
			// 全局 ipcRenderer 上留下一个 listener，长期累积会触发 Oilpan OOM。
			if (myOpenToken !== getOpenSessionToken()) {
				unsubscribeFn();
				return;
			}
			setCurrentUnsubscribe(unsubscribeFn);
			if (cachedKey) {
				setLastActiveSession({ cwd, sessionPath: cachedKey });
			}

			// ADR-0007: 侧边栏 sessionsMap 挂在「对话」项目根；运行 cwd 可能是 UUID 子目录。
			// 必须归一到 bucket 再 list，否则 fork/打开已有会话后侧栏不出现该条。
			const bucketCwd = conversationBucketCwd(effectiveCwd, defaultConversationCwdRef.current);
			await loadSessions(bucketCwd);
			// 乐观兜底：fork 刚写出的文件若 list 未收录，再插入一次（已有则不动，避免改 modifiedAt 排序）。
			if (cachedKey) {
				const listed = getDefaultStore().get(sessionsMapAtom).get(bucketCwd) ?? [];
				if (!listed.some((s) => s.path === cachedKey)) {
					const firstUser = mapped.find((m) => m.role === "user");
					const firstMessage =
						(firstUser?.text ?? "").trim().slice(0, 80) || i18n.t("chat:session.emptyMessageLabel");
					ensureLocalSession(bucketCwd, {
						id: sessionId,
						path: cachedKey,
						cwd: effectiveCwd,
						firstMessage,
						modifiedAt: Date.now(),
						parentSessionPath,
						parentEntryId,
					});
				}
			}
		},
		[
			setChatMessages,
			setActiveSession,
			setActiveSessionStreaming,
			setIsCompacting,
			setRetryProgress,
			setIsReloadingMcp,
			navigate,
			loadSessions,
			ensureLocalSession,
			setLastTurnUsage,
			setLastActiveSession,
			setContextUsage,
			setModelSupportsImages,
			setSessionExecutionMode,
			setActiveToolNames,
			setCurrentScenario,
			setSelectedModel,
			setBackgroundTasks,
			setSubagents,
			setTodoItems,
			flushDeltas,
			scheduleDeltaFlush,
			applyLocalRename,
			setInlineFilePreview,
			setPromptSuggestions,
			bumpSuggestionToken,
			markPredicting,
		],
	);

	// Keep ref in sync so shortcut handler can call openSession
	openSessionRef.current = openSession;

	// Expose openSession globally via ref for other pages (e.g. AutomationPage)
	openSessionFnRef.current = openSession;

	const sendMessage = useCallback(
		async (overrideText?: string, options?: { metadata?: Record<string, unknown>; settingsAssistTabId?: string }) => {
			// 读 ref 而非 state：允许在同一 tick 内先 openSession 再立即 sendMessage
			// （例如 NewSessionPage 的"创建会话+发送"组合调用），避免 React 闭包拿到旧 null。
			const session = activeSessionRef.current ?? activeSession;
			// 不订阅输入 atom；调用时读取还能覆盖“先写草稿、同一流程立即发送”的场景。
			const inputValue = getDefaultStore().get(inputValueAtom);
			const attachedImages = attachedImagesRef.current;
			const selectedSkill = selectedSkillRef.current;
			const mentionedFiles = mentionedFilesRef.current;
			const appshot = appshotRef.current;
			const selectedModel = selectedModelRef.current;
			// overrideText：来自输入预测建议（点击 bubble / 空输入回车按 placeholder 发送），
			// 作为独立 prompt 直发，不带技能 / @文件前缀，也不消费当前草稿与附图。
			const override = typeof overrideText === "string" ? overrideText.trim() : "";
			const hasOverride = override.length > 0;
			if (
				!session?.runtimeId ||
				(!hasOverride &&
					!inputValue.trim() &&
					attachedImages.length === 0 &&
					mentionedFiles.length === 0 &&
					!appshot)
			) {
				return;
			}
			// 发出新 prompt：清空该会话的输入预测，并作废仍在飞的生成（过期判定）。
			bumpSuggestionToken(session.runtimeId);
			setPromptSuggestions((prev) => {
				if (!(session.runtimeId in prev)) return prev;
				const next = { ...prev };
				delete next[session.runtimeId];
				return next;
			});
			const rawText = hasOverride ? override : inputValue.trim();
			const images = !hasOverride && attachedImages.length > 0 ? attachedImages : undefined;
			// 把附图落盘到会话图片缓存，改用 @路径 引用而非把 base64 塞进上下文：
			// 视觉模型经 Read 工具即可看到图，不支持视觉的模型也能用工具对图做 OCR/改图等。
			let imagePaths: string[] = [];
			if (images) {
				try {
					imagePaths = await window.vetta.dialog.persistImages(
						session.runtimeId,
						images.map((img) => ({ id: img.id, data: img.data, mimeType: img.mimeType })),
					);
				} catch (err) {
					console.error("[useSessionManager.sendMessage] persistImages failed:", err);
				}
			}
			const promptRef =
				!hasOverride && selectedSkill
					? {
							kind: selectedSkill.type === "scene" ? ("scene" as const) : ("skill" as const),
							name: selectedSkill.name,
						}
					: undefined;
			const attachmentsByPath = new Map<string, PromptAttachmentRef>();
			if (!hasOverride) {
				for (const file of mentionedFiles) {
					attachmentsByPath.set(file.path, {
						kind: file.isDirectory ? "directory" : isUserImageFile(file.path) ? "image" : "file",
						path: file.path,
					});
				}
				if (appshot?.imagePath) {
					attachmentsByPath.set(appshot.imagePath, { kind: "image", path: appshot.imagePath });
				}
				if (appshot?.textPath) {
					attachmentsByPath.set(appshot.textPath, { kind: "file", path: appshot.textPath });
				}
				for (const path of imagePaths) {
					attachmentsByPath.set(path, { kind: "image", path });
				}
			}
			const attachments = [...attachmentsByPath.values()];
			const text = rawText;
			recordInputContextUsed({
				files: hasOverride ? [] : mentionedFiles,
				images: images ?? [],
				...(hasOverride || !selectedSkill
					? {}
					: {
							promptRef: {
								kind: selectedSkill.type === "scene" ? "scene" : "skill",
								name: selectedSkill.name,
							},
						}),
			});
			// 行内 skill 是软引用，不进 promptRef，但调用次数仍要计入 app-monitor
			// （命令面板按使用频次排序依赖这份统计）。每个被引用的 skill 记一次。
			if (!hasOverride) {
				for (const name of deriveSkillNames(parseInputSegments(rawText).segments)) {
					recordInputContextUsed({ promptRef: { kind: "skill", name } });
				}
			}
			if (!hasOverride) {
				// 记入本作用域历史并清草稿（含 input / skill / appshot 工作集与 map 条目）。
				recordSentInputAndClearDraft(rawText);
				setAttachedImages([]);
				setMentionedFiles([]);
			}
			// 最后一条用户消息重编辑：提交时先中止当前生成，再删除旧消息及其回复子树；
			// 随后的正常 prompt 从原 parent 继续，因此不会创建会话内分支。
			const store = getDefaultStore();
			const pendingEdit = store.get(pendingMessageEditAtom);
			if (pendingEdit) {
				if (store.get(isStreamingAtom)) {
					await new Promise<void>((resolve) => {
						let settled = false;
						let unsubscribe: () => void = () => {};
						const finish = (): void => {
							if (settled) return;
							settled = true;
							unsubscribe();
							clearTimeout(timer);
							resolve();
						};
						const timer = setTimeout(finish, 8000);
						unsubscribe = window.vetta.session.onRunningChanged((p) => {
							if (p.sessionId === session.runtimeId && p.running === false) finish();
						});
						if (!store.get(isStreamingAtom)) {
							finish();
							return;
						}
						void window.vetta.session.abort(session.runtimeId).catch((err) => {
							console.error("[useSessionManager.sendMessage] abort before edit failed:", err);
						});
					});
				}
				try {
					await window.vetta.session.replaceLastUserMessage(session.runtimeId, pendingEdit.entryId);
					const history = await window.vetta.session.getFullHistory(session.runtimeId);
					setChatMessages(fullHistoryToChat(history));
					store.set(pendingMessageEditAtom, null);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error("[useSessionManager.sendMessage] replaceLastUserMessage failed:", err);
					store.set(pendingMessageEditAtom, null);
					setChatMessages((prev) => appendError(prev, message));
					return;
				}
			}

			// streaming 期间发送 = 排队等下一轮：跳过「用户气泡 / 清产物列表 / 乐观侧边栏 /
			// 清 todo」这些开启新一轮才该有的副作用，仅在下方组装好 promptReq 快照后入队。
			// （输入框已在上方清空，符合「入队后清空输入框」语义。）
			const streaming = pendingEdit ? false : getDefaultStore().get(isStreamingAtom);
			if (!streaming) {
				const userMsg: ChatMessage = {
					id: nextId("user"),
					role: "user",
					text,
					timestamp: Date.now(),
					model: modelKeyToParts(selectedModel),
					promptRef,
					attachments,
				};
				// Base64 preview only when persistence failed; structured image paths
				// are otherwise the canonical source for optimistic and restored UI.
				if (images && imagePaths.length === 0) {
					userMsg.images = images.map((img) => ({ data: img.data, mimeType: img.mimeType, name: img.name }));
				}
				if (appshot) {
					userMsg.appshot = appshot;
				}
				userMsg.mentionedFiles = mentionedFiles.slice();
				const settingsAssistTabId = options?.settingsAssistTabId?.trim();
				if (settingsAssistTabId) {
					userMsg.settingsAssistTabId = settingsAssistTabId;
				}
				setChatMessages((prev) => [...prev, userMsg]);
			}

			// Optimistically expose this session in the sidebar before the disk file
			// has been flushed (SessionManager only writes after the assistant's
			// first message). Use the user's prompt prefix as a temporary label;
			// auto-title or the next loadSessions will overwrite as appropriate.
			const sp = activeSessionRef.current?.sessionPath;
			if (!streaming && sp) {
				// ADR-0007：「对话」session 的 cwd 是默认项目根下的 per-session 子目录，
				// 但侧边栏 sessionsMap / 默认列表都挂在项目根 bucket 上。乐观行必须落到根
				// bucket，否则既不在「会话」列表显示，auto-title 的 applyLocalRename(root,…)
				// 也会因 bucket 不匹配而落空，导致改名要等下一次磁盘刷新才生效。
				const bucketCwd = conversationBucketCwd(session.cwd, defaultConversationCwdRef.current);
				ensureLocalSession(bucketCwd, {
					id: session.runtimeId,
					path: sp,
					cwd: session.cwd,
					firstMessage: rawText.slice(0, 80) || i18n.t("chat:session.emptyMessageLabel"),
					modifiedAt: Date.now(),
				});
			}

			// 检查当前 session 是否归属一个 paused 的 batch-task 子任务。命中则改走
			// resume 路径（入队首，由调度器按并发数放行），跳过 session.prompt。
			let pausedBatch: { projectId: string; taskId: string } | undefined;
			for (const p of batchProjectsRef.current) {
				const matched = p.tasks.find((t) => t.sessionId === session.runtimeId && t.status === "paused");
				if (matched) {
					pausedBatch = { projectId: p.id, taskId: matched.id };
					break;
				}
			}

			if (pausedBatch) {
				try {
					// The batch resume contract still accepts text only. Preserve attachment
					// behavior there through the legacy prefix format until that API is migrated.
					const legacyText = attachments.length
						? `${attachments.map((attachment) => `@${attachment.path}`).join("\n")}\n${text}`
						: text;
					await window.vetta.batchTasks.resumeTaskWithText(pausedBatch.projectId, pausedBatch.taskId, legacyText);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error("[useSessionManager.sendMessage] resumeTaskWithText rejected:", err);
					setChatMessages((prev) => appendError(prev, message));
				}
				await loadSessions(session.cwd);
				return;
			}

			// 非批量任务项目：若该 session 已有 todo 且全部 done，在发起下一个
			// prompt 前先清空 todo 列表，让用户开启新一轮工作时面板回到干净状态。
			// 批量任务依赖严格 todo 机制，不在此清空；scene 等 lock 状态后端会自行拒绝。
			// streaming 入队时不清：当前正在跑的回合仍拥有这些 todo。
			if (!streaming) {
				const projectType = getProjects().find((p) => p.cwd === session.cwd)?.type;
				if (projectType !== "batch") {
					const items = todoItemsMapRef.current.get(session.runtimeId) ?? [];
					if (items.length > 0 && items.every((i) => i.status === "done")) {
						try {
							await window.vetta.session.clearTodos(session.runtimeId);
						} catch (err) {
							console.error("[useSessionManager.sendMessage] clearTodos failed:", err);
						}
					}
				}
			}

			const promptReq: PromptRequest = {
				text: text || "(see attached content)",
				promptRef,
			};
			if (attachments.length > 0 || pendingEdit) {
				promptReq.attachments = attachments;
			}
			if (images && imagePaths.length === 0) {
				promptReq.images = images.map((image) => ({
					type: "image",
					data: image.data,
					mimeType: image.mimeType,
				}));
			}
			if (selectedModel) {
				promptReq.modelKey = selectedModel;
				// Per-model reasoning level rides alongside modelKey (see reasoning-level design).
				const level = getDefaultStore().get(reasoningByModelAtom)[selectedModel];
				if (level) promptReq.reasoning = level;
			}
			// Caller-supplied metadata first (e.g. settings AI assist model-only instruction).
			if (options?.metadata && Object.keys(options.metadata).length > 0) {
				promptReq.metadata = { ...options.metadata };
			}
			// Merge metadata and hidden instructions contributed by active plugin
			// input actions.
			const pluginStore = getDefaultStore();
			const usedInputActions: Parameters<typeof recordInputActionsUsed>[0] = [];
			const pluginInstructions: string[] = [];
			const pluginPromptContexts: Array<PluginPromptContext & { pluginId: string }> = [];
			const activeActionIds = pluginStore.get(activeInputActionIdsAtom);
			if (activeActionIds.size > 0) {
				for (const action of pluginStore.get(pluginInputActionsAtom)) {
					if (!activeActionIds.has(action.actionId)) continue;
					const decoration = action.decoratePrompt?.();
					if (decoration?.metadata) {
						promptReq.metadata = { ...promptReq.metadata, ...decoration.metadata };
					}
					if (decoration?.instructions) {
						pluginInstructions.push(
							...decoration.instructions.filter(
								(instruction) => typeof instruction === "string" && instruction.trim().length > 0,
							),
						);
					}
					if (decoration?.metadata || decoration?.instructions) {
						usedInputActions.push({ actionId: action.actionId, actionKind: "plugin" });
					}
				}
			}
			// 原生「知识检索」开关（硬隔离）：开启后本轮携带 knowledgeMode——
			// input-pipeline 暴露 kb-read 工具并注入仅模型可见的「优先查询知识库」提示。
			if (pluginStore.get(knowledgeRetrievalActiveAtom)) {
				promptReq.metadata = { ...promptReq.metadata, knowledgeMode: true };
				usedInputActions.push({
					actionId: BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID,
					actionKind: "builtin",
				});
			}
			// Plugin-owned attachment data stays structured until the coding-agent
			// input boundary. Legacy metadata/instructions remain supported.
			const promptAttachment = pluginStore.get(promptAttachmentAtom);
			if (promptAttachment) {
				if (promptAttachment.metadata) {
					promptReq.metadata = { ...promptReq.metadata, ...promptAttachment.metadata };
				}
				pluginInstructions.push(
					...(promptAttachment.instructions ?? []).filter(
						(instruction) => typeof instruction === "string" && instruction.trim().length > 0,
					),
				);
				if (promptAttachment.context) {
					pluginPromptContexts.push({
						pluginId: promptAttachment.ownerPluginId,
						...structuredClone(promptAttachment.context),
					});
				}
				if (promptAttachment.lifecycle !== "sticky") {
					pluginStore.set(promptAttachmentAtom, null);
				}
			}
			if (pluginInstructions.length > 0) {
				promptReq.metadata = { ...promptReq.metadata, pluginInstructions };
			}
			if (pluginPromptContexts.length > 0) {
				promptReq.metadata = { ...promptReq.metadata, pluginPromptContexts };
			}
			recordInputActionsUsed(usedInputActions);
			// streaming 中：把组装好的完整 promptReq 快照入队，等当前回合自然 agent_end 后
			// 由 subscribe 的出队逻辑作为新一轮 prompt 发出；本次不调用 prompt。
			if (streaming) {
				pluginStore.set(enqueueMessageAtom, {
					runtimeId: session.runtimeId,
					item: { id: crypto.randomUUID(), request: promptReq, displayText: rawText },
				});
				return;
			}
			try {
				await waitForPluginHostReady();
				await window.vetta.session.prompt(session.runtimeId, promptReq);
			} catch (err) {
				// RuntimeHost.prompt 现在会先把 prompt 期同步抛错（"No model
				// selected" / "No API key found" / "Agent is already processing"
				// 等）转换成 error 事件广播给所有订阅者，再把异常向上抛——所以
				// 正常情况下这里 catch 到的时候 chat 里已经多了一条 error block。
				// 但保留这层兜底是因为：(1) 旧版 RuntimeHost 或其它 host 实现未
				// 必有合成事件机制；(2) IPC 链路自身（preload / electron）出错
				// 时不会经过 RuntimeHost。任何 reject 在这里直接落成一条 error
				// 气泡，杜绝「按了发送但屏幕完全没反应」的死寂体验。
				const message = err instanceof Error ? err.message : String(err);
				console.error("[useSessionManager.sendMessage] prompt rejected:", err);
				setChatMessages((prev) => appendError(prev, message));
			}
			// ADR-0007：归一回项目根 bucket，否则「对话」session 刷的是没用的子目录桶，
			// 侧边栏默认列表（挂在根 bucket）拿不到这一轮的对账更新。
			await loadSessions(conversationBucketCwd(session.cwd, defaultConversationCwdRef.current));
		},
		[
			// 输入文本调用时读 store，其余输入相关值读 ref，不再入依赖，保证
			// sendMessage 身份在打字时稳定，避免下游
			// Virtuoso footer 重挂载（footer 内的插件 turn 卡会因此闪烁/重查）。
			activeSession,
			setAttachedImages,
			setMentionedFiles,
			setChatMessages,
			loadSessions,
			ensureLocalSession,
			setPromptSuggestions,
			bumpSuggestionToken,
		],
	);

	const abortMessage = useCallback(async () => {
		if (!activeSession?.runtimeId) return;
		await window.vetta.session.abort(activeSession.runtimeId);
	}, [activeSession]);

	// 立即发送某条排队消息（队列面板点击 / 拖拽后即时发）：取出即从队列移除；
	// 若该会话正在 streaming，先中止当前流并等其真正停下（running-changed），再作为
	// 普通 prompt 发出；空闲则直接发。其余排队项保留，待这条自然结束后由出队逻辑继续逐条发。
	const sendQueuedNow = useCallback(
		async (runtimeId: string, id: string) => {
			const store = getDefaultStore();
			const item = getQueueForSession(store.get(messageQueueBySessionAtom), runtimeId).find((q) => q.id === id);
			if (!item) return;
			// 取出即移除，避免后续自然 agent_end 的出队逻辑再次发它。
			store.set(removeQueuedMessageAtom, { runtimeId, id });

			if (store.get(isStreamingAtom)) {
				// 立即发送要 abort 掉当前回合再发新的——被 abort 回合的 agent_end 会触发整体
				// 重拉，那次重拉已「跨到下一轮」。先 +1 序号，使其在落地时被判为过期而跳过，
				// 避免冲掉下方乐观气泡 / 令新一轮 draft 续写到被中断的旧 assistant 上。
				bumpQueuedDispatchSeq(runtimeId);
				// 中止当前流并等它真正停下再发。注意 runtime 把 abort 也走 agent_end
				// （lifecycle 从不发 "aborted" phase），所以不能等生命周期事件；但
				// running-changed 一定会广播 running=false。用一次性监听等它，带超时兜底。
				await new Promise<void>((resolve) => {
					let settled = false;
					let unsubscribe: () => void = () => {};
					const finish = (): void => {
						if (settled) return;
						settled = true;
						unsubscribe();
						clearTimeout(timer);
						resolve();
					};
					const timer = setTimeout(finish, 8000);
					unsubscribe = window.vetta.session.onRunningChanged((p) => {
						if (p.sessionId === runtimeId && p.running === false) finish();
					});
					// 订阅前可能流已停（事件已发过）：补一次检查直接放行。
					if (!store.get(isStreamingAtom)) {
						finish();
						return;
					}
					void window.vetta.session.abort(runtimeId).catch((err) => {
						console.error("[useSessionManager.sendQueuedNow] abort failed:", err);
					});
				});
			}

			const queuedUserMsg: ChatMessage = {
				id: nextId("user"),
				role: "user",
				text: item.request.text,
				timestamp: Date.now(),
				model: modelKeyToParts(item.request.modelKey),
				promptRef: item.request.promptRef,
				attachments: item.request.attachments,
			};
			setChatMessages((prev) => [...prev, queuedUserMsg]);
			try {
				await waitForPluginHostReady();
				await window.vetta.session.prompt(runtimeId, item.request);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[useSessionManager.sendQueuedNow] prompt rejected:", err);
				setChatMessages((prev) => appendError(prev, message));
			}
		},
		[setChatMessages],
	);

	// Expose the full send path to the plugin conversation bridge (ctx.conversation.sendPrompt).
	pluginSendMessageRef.current = sendMessage;
	// Settings AI assist / other pages: openSession then sendMessage in the same flow.
	sendMessageFnRef.current = sendMessage;

	return { openSession, sendMessage, abortMessage, sendQueuedNow, openSessionRef };
}

/**
 * 取最近最多 3 轮（以 user 消息为界）对话文本，用作输入预测的上下文。
 * 过滤 compaction 与空文本（纯工具轮），逐条截断，整体封顶 4000 字。
 */
function buildRecentConversation(messages: ChatMessage[]): string {
	const relevant = messages.filter((m) => m.role === "user" || m.role === "assistant");
	let startIdx = relevant.length;
	let userCount = 0;
	for (let i = relevant.length - 1; i >= 0; i--) {
		if (relevant[i].role === "user") {
			userCount++;
			startIdx = i;
			if (userCount >= 3) break;
		}
	}
	const lines: string[] = [];
	for (const m of relevant.slice(startIdx)) {
		const text = (m.text ?? "").trim();
		if (!text) continue;
		// 标签必须用英文：中文标签会给预测模型「本会话说中文」的信号，
		// 用户全程英文也会拿到中文建议（语言由用户消息决定，见 peripheral-tasks.ts）。
		lines.push(`${m.role === "user" ? "User" : "Assistant"}: ${text.slice(0, 600)}`);
	}
	return lines.join("\n\n").slice(0, 4000);
}
