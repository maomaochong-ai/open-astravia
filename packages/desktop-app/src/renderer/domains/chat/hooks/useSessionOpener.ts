import { useProjectActions } from "@domains/project/hooks/useProjects";
import { i18n } from "@shared/i18n";
import {
	activeSessionAtom,
	activeSessionStreamingAtom,
	activeToolNamesAtom,
	adoptExistingSessionInputDraft,
	batchProjectsAtom,
	chatMessagesAtom,
	claimNewSessionInputDraft,
	contextUsageAtom,
	conversationBucketCwd,
	currentScenarioAtom,
	defaultConversationCwdAtom,
	inlineFilePreviewAtom,
	isCompactingAtom,
	lastActiveSessionAtom,
	lastTurnUsageAtom,
	modelSupportsImagesAtom,
	newSessionInputDraftKey,
	type Project,
	pendingMessageEditAtom,
	projectsAtom,
	retryProgressAtom,
	type SessionExecutionMode,
	selectedModelAtom,
	sessionExecutionModeAtom,
	sessionsMapAtom,
} from "@shared/store/atoms";
import { setQueueForSessionAtom, setQueuePausedAtom } from "@shared/store/message-queue-atoms";
import { useNavigate } from "@tanstack/react-router";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { type MutableRefObject, useCallback, useRef } from "react";
import {
	adoptDraftId,
	bumpOpenSessionToken,
	currentUnsubscribe,
	fullHistoryToChat,
	getOpenSessionToken,
	resetStreamState,
	setCurrentUnsubscribe,
	setTurnStartTime,
	turnStatsCache,
} from "../services/chat-service";
import { resolveSessionContextComposition } from "../services/context-composition-cache";
import { reconcileOptimisticUserMessages } from "../services/optimistic-user-message-cache";
import { useSessionEventController } from "./useSessionEventController";

export interface SessionOpenerController {
	openSession: (
		cwd: string,
		sessionPath?: string,
		executionMode?: SessionExecutionMode,
		options?: { navigate?: boolean },
	) => Promise<void>;
	openSessionRef: MutableRefObject<SessionOpenerController["openSession"] | undefined>;
	bumpSuggestionToken: (runtimeId: string) => void;
}

function getProjects(): Project[] {
	return getDefaultStore().get(projectsAtom);
}

export function useSessionOpener(): SessionOpenerController {
	const setActiveSession = useSetAtom(activeSessionAtom);
	const setChatMessages = useSetAtom(chatMessagesAtom);
	const setActiveSessionStreaming = useSetAtom(activeSessionStreamingAtom);
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
	const setIsCompacting = useSetAtom(isCompactingAtom);
	const setRetryProgress = useSetAtom(retryProgressAtom);
	const setInlineFilePreview = useSetAtom(inlineFilePreviewAtom);
	// 用于判断当前 session 是否归属一个 paused 的 batch-task 子任务。命中时
	// sendMessage 改走 batchTasks.resumeTaskWithText 入队首恢复运行，而不是
	// 直接 session.prompt 立即 streaming（与并发上限共生）。
	const batchProjects = useAtomValue(batchProjectsAtom);
	const batchProjectsRef = useRef(batchProjects);
	batchProjectsRef.current = batchProjects;
	const { loadSessions, ensureLocalSession } = useProjectActions();
	// ADR-0007：「对话」session 运行 cwd 是项目根下的 per-session 子目录，但其 jsonl 与
	// 侧边栏 sessionsMap bucket 都挂在项目根 cwd 上。重命名/刷新必须落到「根」bucket，
	// 否则侧边栏与顶部标题读不到更新。用此 ref 把子目录 cwd 归一回项目根。
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const defaultConversationCwdRef = useRef(defaultConversationCwd);
	defaultConversationCwdRef.current = defaultConversationCwd;
	const activeSessionRef = useRef<{ cwd: string; sessionPath: string; runtimeId: string } | null>(null);
	const { bumpSuggestionToken, createSessionEventHandler, markAutoTitleHandled, resetEventBuffers } =
		useSessionEventController({ activeSessionRef });
	const openSessionRef = useRef<
		| ((
				cwd: string,
				sessionPath?: string,
				executionMode?: SessionExecutionMode,
				options?: { navigate?: boolean },
		  ) => Promise<void>)
		| undefined
	>(undefined);

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
			resetEventBuffers();
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
			const canonicalSessionPath = createResult.sessionPath || sessionPath || "";
			// ADR-0007: 「对话」项目下 main 会把 cwd 改写成 per-session 子目录，
			// 这里以 main 返回的 effective cwd 为准，保证 FilesPanel/调试 cwd 都指向子目录。
			const effectiveCwd = createResult.cwd ?? cwd;

			// 拿到 sessionId 就立即写 activeSession；默认再 navigate 到 ChatView。
			// main 返回 Runtime 实际持有的 canonical sessionPath；历史会话导入时它不同于
			// 用户选择的 Legacy 源路径，必须立即采用，避免切回后再次触发迁移。
			// 这样 Welcome → Chat 的转场就不会被 getFullHistory / getState / getSessionPath
			// 的串行 IPC 拖住，体感保持瞬时。
			// navigate:false：设置页 AI 协助等场景只后台建会话，留在当前路由，由侧栏高亮 + 飞球引导。
			const earlySessionInfo = { cwd: effectiveCwd, sessionPath: canonicalSessionPath, runtimeId: sessionId };
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
			const mapped = reconcileOptimisticUserMessages(sessionId, fullHistoryToChat(history));
			setChatMessages(mapped);

			// If this session already has any prior turn (loaded from disk) we never
			// want to auto-rename — only brand-new sessions on their first round.
			if (sessionPath && mapped.some((m) => m.role === "user")) {
				markAutoTitleHandled(canonicalSessionPath);
			}

			const state = await statePromise;
			const resolvedSessionPath =
				canonicalSessionPath || (await window.vetta.session.getSessionPath(sessionId)) || sessionPath || "";
			const cachedKey = resolvedSessionPath;
			const contextComposition = resolveSessionContextComposition(resolvedSessionPath, state.contextComposition);
			setContextUsage({
				percent: state.contextPercent,
				contextWindow: state.contextWindow,
				...(contextComposition ? { composition: contextComposition } : {}),
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
			const unsubscribeFn = await window.vetta.session.subscribe(sessionId, createSessionEventHandler(sessionId));

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

			// kernel 队列镜像初始化（ADR-0060）：整体替换、不做消费差分——后台期间被
			// 消费的条目由历史重放呈现，这里只要拿到当前真实队列与 paused 状态。
			void window.vetta.session
				.getQueueState(sessionId)
				.then((state) => {
					if (activeSessionRef.current?.runtimeId !== sessionId) return;
					const queueStore = getDefaultStore();
					queueStore.set(setQueueForSessionAtom, {
						runtimeId: sessionId,
						items: state.entries.map((entry) => ({
							id: entry.id,
							displayText: entry.displayText,
							behavior: entry.behavior,
						})),
					});
					queueStore.set(setQueuePausedAtom, { runtimeId: sessionId, paused: state.paused });
				})
				.catch((err) => {
					console.warn("[useSessionManager] getQueueState failed", err);
				});

			// ADR-0007: 侧边栏 sessionsMap 挂在「对话」项目根；运行 cwd 可能是 UUID 子目录。
			// 必须归一到 bucket 再 list，否则 fork/打开已有会话后侧栏不出现该条。这里不再
			// 阻塞 openSession：新会话的首条 prompt 只依赖上面的订阅与运行时状态，侧边栏
			// 对账可以在发送之后异步完成。
			const bucketCwd = conversationBucketCwd(effectiveCwd, defaultConversationCwdRef.current);
			void loadSessions(bucketCwd)
				.then(() => {
					// 乐观兜底：fork 刚写出的文件若 list 未收录，再插入一次（已有则不动，避免改 modifiedAt 排序）。
					if (!cachedKey) return;
					const listed = getDefaultStore().get(sessionsMapAtom).get(bucketCwd) ?? [];
					if (listed.some((s) => s.path === cachedKey)) return;
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
				})
				.catch((err) => {
					console.warn("[useSessionManager] background session list refresh failed", err);
				});
		},
		[
			setChatMessages,
			setActiveSession,
			setActiveSessionStreaming,
			setIsCompacting,
			setRetryProgress,
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
			createSessionEventHandler,
			setInlineFilePreview,
			markAutoTitleHandled,
			resetEventBuffers,
		],
	);

	openSessionRef.current = openSession;

	return { openSession, openSessionRef, bumpSuggestionToken };
}
