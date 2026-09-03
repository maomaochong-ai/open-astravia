import { useProjectActions } from "@domains/project/hooks/useProjects";
import { i18n } from "@shared/i18n";
import { perfSendMark } from "@shared/lib/perf-send";
import {
	perfSessionSwitchBegin,
	perfSessionSwitchComplete,
	perfSessionSwitchMark,
} from "@shared/lib/perf-session-switch";
import {
	activeSessionAtom,
	activeSessionStreamingAtom,
	activeToolNamesAtom,
	adoptExistingSessionInputDraft,
	batchProjectsAtom,
	chatMessagesAtom,
	claimExistingSessionInputDraft,
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
	type OpenSessionOptions,
	type Project,
	pendingMessageEditAtom,
	pendingSessionCreationAtom,
	pendingSessionOpenAtom,
	projectsAtom,
	retryProgressAtom,
	type SessionExecutionMode,
	selectedModelAtom,
	sessionAgentModeAtom,
	sessionExecutionModeAtom,
	sessionsMapAtom,
} from "@shared/store/atoms";
import { setQueueForSessionAtom, setQueuePausedAtom } from "@shared/store/message-queue-atoms";
import { useNavigate } from "@tanstack/react-router";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { type MutableRefObject, useCallback, useRef } from "react";
import { preserveMessagesAddedAfterSnapshot, shareChatMessageSnapshot } from "../services/chat-message-snapshot";
import {
	appendError,
	bumpOpenSessionToken,
	currentUnsubscribe,
	fullHistoryToChat,
	getOpenSessionToken,
	resetStreamState,
	restoreAssistantTurn,
	setCurrentUnsubscribe,
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
		options?: OpenSessionOptions,
	) => Promise<void>;
	openSessionRef: MutableRefObject<SessionOpenerController["openSession"] | undefined>;
	bumpSuggestionToken: (runtimeId: string) => void;
}

function getProjects(): Project[] {
	return getDefaultStore().get(projectsAtom);
}

type PaintBarrierResult = "painted" | "skipped-hidden" | "timeout";

function waitForCommittedPaint(): Promise<PaintBarrierResult> {
	if (document.visibilityState === "hidden") return Promise.resolve("skipped-hidden");
	if (typeof window.requestAnimationFrame !== "function") {
		return new Promise((resolve) => window.setTimeout(() => resolve("timeout"), 0));
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: PaintBarrierResult): void => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeoutId);
			resolve(result);
		};
		const timeoutId = window.setTimeout(() => finish("timeout"), 100);
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => finish("painted"));
		});
	});
}

export function useSessionOpener(): SessionOpenerController {
	const setActiveSession = useSetAtom(activeSessionAtom);
	const setPendingSessionCreation = useSetAtom(pendingSessionCreationAtom);
	const setPendingSessionOpen = useSetAtom(pendingSessionOpenAtom);
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
	const setSessionAgentMode = useSetAtom(sessionAgentModeAtom);
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
	const { bumpSuggestionToken, createSessionEventHandler, resetEventBuffers } = useSessionEventController({
		activeSessionRef,
	});
	const openSessionRef = useRef<
		| ((
				cwd: string,
				sessionPath?: string,
				executionMode?: SessionExecutionMode,
				options?: OpenSessionOptions,
		  ) => Promise<void>)
		| undefined
	>(undefined);

	const openSession = useCallback(
		async (cwd: string, sessionPath?: string, executionMode?: SessionExecutionMode, options?: OpenSessionOptions) => {
			const isExistingSessionOpen = sessionPath !== undefined;
			const interactionId =
				options?.interactionId ??
				(isExistingSessionOpen ? perfSessionSwitchBegin("existing-session-open") : undefined);
			const markSessionSwitch = (label: string): void => {
				if (isExistingSessionOpen) perfSessionSwitchMark(label, interactionId);
			};
			perfSendMark("open-session-enter", interactionId);
			markSessionSwitch("open-session-enter");
			// 取自己的调用令牌；每个异步边界都执行 newest-wins 校验。
			// subscribe() 若已完成还会立即释放旧操作刚建好的 IPC 订阅，避免泄漏。
			const myOpenToken = bumpOpenSessionToken();
			const shouldNavigate = options?.navigate !== false;
			const navigateBeforeCreate =
				sessionPath === undefined && shouldNavigate && options?.navigateBeforeCreate === true;
			const stageExistingSessionOpen = isExistingSessionOpen && shouldNavigate;
			const clearOwnPendingTransition = (): void => {
				if (navigateBeforeCreate) {
					setPendingSessionCreation((current) => (current?.interactionId === interactionId ? null : current));
				}
				if (stageExistingSessionOpen) {
					setPendingSessionOpen((current) => (current?.interactionId === interactionId ? null : current));
				}
			};
			const finishCancelledOpen = (): void => {
				clearOwnPendingTransition();
				if (isExistingSessionOpen) perfSessionSwitchComplete("cancelled", interactionId);
			};
			const failSessionHydration = (stage: "path" | "history" | "state" | "subscribe", error: unknown): void => {
				if (myOpenToken !== getOpenSessionToken()) {
					finishCancelledOpen();
					return;
				}
				console.error("[useSessionOpener] session hydration failed", { interactionId, stage, error });
				clearOwnPendingTransition();
				const message = error instanceof Error ? error.message : String(error);
				setChatMessages((previous) => appendError(previous, message));
				setActiveSession(null);
				activeSessionRef.current = null;
				if (isExistingSessionOpen) perfSessionSwitchComplete("failed", interactionId);
			};
			if (navigateBeforeCreate) {
				setPendingSessionCreation({ cwd, interactionId: interactionId ?? "" });
			} else if (stageExistingSessionOpen) {
				setPendingSessionOpen({ cwd, sessionPath, interactionId: interactionId ?? "" });
				// Draft ownership follows the user's click immediately. Runtime readiness
				// must not be required for typing, attachments or sending to target state.
				adoptExistingSessionInputDraft(sessionPath);
			}
			if (navigateBeforeCreate) {
				perfSendMark("session-route-start", interactionId);
				await navigate({ to: "/" });
				perfSendMark("session-route-ready", interactionId);
				if (myOpenToken !== getOpenSessionToken()) {
					finishCancelledOpen();
					return;
				}
			} else if (stageExistingSessionOpen) {
				// Existing-session restoration must not await a route commit before the old
				// message tree is cleared. Keeping navigation, pending state and teardown in
				// one event batch avoids an expensive intermediate render of the old history.
				void navigate({ to: "/" });
				markSessionSwitch("navigation-dispatched");
			}
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
			if (!options?.preserveMessagesBeforeCreate) setChatMessages([]);
			getDefaultStore().set(pendingMessageEditAtom, null);
			// 切会话先把激活工具集置未知（null）→ badge 回退显示，等 getState 回填真实集合。
			setActiveToolNames(null);
			// 场景同样置未知（null）→ 插件插槽 fail-closed 暂不显示，等 getState 回填后按场景显隐。
			setCurrentScenario(null);
			// 本会话工作模式同样置未知，等 getState 回填；绝不回退到全局默认值。
			setSessionAgentMode(null);
			if (stageExistingSessionOpen) {
				setActiveSession(null);
				activeSessionRef.current = null;
			}
			markSessionSwitch("renderer-reset-complete");
			if (navigateBeforeCreate) {
				const paintBarrierResult = await waitForCommittedPaint();
				perfSendMark("session-route-painted", interactionId);
				markSessionSwitch(paintBarrierResult === "painted" ? "pending-ui-painted" : "pending-ui-paint-timeout");
				if (myOpenToken !== getOpenSessionToken()) {
					finishCancelledOpen();
					return;
				}
			} else if (stageExistingSessionOpen) {
				// Atom updates are committed synchronously; the async IPC below yields the
				// Renderer event loop so the browser can paint without delaying Runtime
				// restoration. A hard rAF/timer barrier can be throttled for occluded windows.
				markSessionSwitch("pending-ui-scheduled");
			}

			// Existing-session history is a presentation concern and does not depend on
			// acquiring the interactive Runtime handle. Read the file through the existing
			// lock-free viewer path so the first meaningful content can render before Runtime
			// capabilities, state and the live subscription begin restoring.
			// Runtime hydration below remains canonical and will reconcile streaming drafts.
			let previewMessagesSnapshot: ReturnType<typeof fullHistoryToChat> | undefined;
			let previewPresentation: Promise<void> | undefined;
			if (stageExistingSessionOpen) {
				markSessionSwitch("session-preview-history-start");
				previewPresentation = window.vetta.session
					.openViewer(sessionPath)
					.then(async (snapshot) => {
						markSessionSwitch("session-preview-history-loaded");
						if (myOpenToken !== getOpenSessionToken()) {
							markSessionSwitch("session-preview-history-superseded");
							return;
						}
						const previewMessages = fullHistoryToChat(snapshot.history);
						previewMessagesSnapshot = previewMessages;
						markSessionSwitch("session-preview-history-mapped");
						if (myOpenToken !== getOpenSessionToken()) {
							markSessionSwitch("session-preview-history-superseded");
							return;
						}
						setChatMessages(previewMessages);
						markSessionSwitch("session-preview-history-committed");
						const paintBarrierResult = await waitForCommittedPaint();
						if (myOpenToken === getOpenSessionToken()) {
							markSessionSwitch(
								paintBarrierResult === "painted"
									? "session-preview-history-painted"
									: paintBarrierResult === "skipped-hidden"
										? "session-preview-history-paint-skipped-hidden"
										: "session-preview-history-paint-timeout",
							);
						}
					})
					.catch(() => {
						// Preview is best-effort. The canonical Runtime history load below still
						// owns error reporting and can complete the open normally.
						if (myOpenToken === getOpenSessionToken()) previewMessagesSnapshot = [];
						markSessionSwitch("session-preview-history-failed");
					});
			}
			if (previewPresentation) {
				await previewPresentation;
				if (myOpenToken !== getOpenSessionToken()) {
					finishCancelledOpen();
					return;
				}
			}

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
			let createResult: Awaited<ReturnType<typeof window.vetta.session.create>>;
			try {
				perfSendMark("session-create-start", interactionId);
				markSessionSwitch("session-create-start");
				createResult = await window.vetta.session.create(
					{ cwd, sessionPath, executionMode, scenario },
					sessionKind,
					interactionId ? { interactionId } : undefined,
				);
				perfSendMark("session-create-end", interactionId);
				markSessionSwitch("session-create-end");
			} catch (error) {
				perfSendMark("session-create-failed", interactionId);
				markSessionSwitch("session-create-failed");
				if (isExistingSessionOpen) perfSessionSwitchComplete("failed", interactionId);
				const message = error instanceof Error ? error.message : String(error);
				console.error("[useSessionOpener] session.create failed:", error);
				setChatMessages((prev) => {
					const last = prev.at(-1);
					const lastError = last?.kind === "agent" ? last.blocks.at(-1) : undefined;
					if (last?.kind === "agent" && lastError?.type === "error" && lastError.text === message) return prev;
					return appendError(prev, message);
				});
				setActiveSession(null);
				activeSessionRef.current = null;
				clearOwnPendingTransition();
				if (navigateBeforeCreate) {
					try {
						options?.onCreateError?.(error);
					} catch (restoreError) {
						console.error("[useSessionOpener] staged input restore failed:", restoreError);
					}
					void navigate({
						to: "/new-session/$cwd",
						params: { cwd: encodeURIComponent(cwd) },
					});
				} else if (shouldNavigate) {
					void navigate({ to: "/" });
				}
				return;
			}
			const { sessionId } = createResult;
			if (myOpenToken !== getOpenSessionToken()) {
				markSessionSwitch("session-create-superseded");
				finishCancelledOpen();
				return;
			}
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
			markSessionSwitch("active-session-set");
			if (shouldNavigate && !navigateBeforeCreate && !stageExistingSessionOpen) {
				void navigate({ to: "/" });
				markSessionSwitch("navigation-dispatched");
			}
			let resolvedSessionPath: string;
			try {
				resolvedSessionPath =
					canonicalSessionPath || (await window.vetta.session.getSessionPath(sessionId)) || sessionPath || "";
			} catch (error) {
				failSessionHydration("path", error);
				return;
			}
			if (myOpenToken !== getOpenSessionToken()) {
				finishCancelledOpen();
				return;
			}
			const cachedKey = resolvedSessionPath;
			let subscribed = false;
			const subscribeForPrompt = async (): Promise<boolean> => {
				perfSendMark("session-subscribe-start", interactionId);
				markSessionSwitch("session-subscribe-start");
				let unsubscribeFn: () => void;
				try {
					unsubscribeFn = await window.vetta.session.subscribe(sessionId, createSessionEventHandler(sessionId));
				} catch (error) {
					failSessionHydration("subscribe", error);
					return false;
				}
				perfSendMark("session-subscribe-end", interactionId);
				markSessionSwitch("session-subscribe-end");

				// 校验令牌：如果 await 期间用户已经切换到下一个 session，本次的
				// subscribe 已经成了孤儿，必须立即释放，不能覆盖后来者的订阅。
				if (myOpenToken !== getOpenSessionToken()) {
					unsubscribeFn();
					finishCancelledOpen();
					return false;
				}
				setCurrentUnsubscribe(unsubscribeFn);
				subscribed = true;
				perfSendMark("open-session-ready", interactionId);
				if (cachedKey) setLastActiveSession({ cwd, sessionPath: cachedKey });
				// 只派发首条 Prompt，绝不等它跑完：session.prompt 的 IPC 要到整轮 turn
				// 结束（或用户暂停）才 resolve。一旦 await，下面的 getState 回填
				// （scenario / activeToolNames / 上下文用量 / 工作模式）和本次过渡的收尾
				// 都会被推迟到本轮流式输出之后——期间 scenario 停在 null，插件页签与输入
				// 栏动作会整体消失，pending 过渡还会挡住本轮内的后续发送。
				try {
					const promptReady = options?.onPromptReady?.();
					if (promptReady) {
						void promptReady.catch((error: unknown) => {
							console.error("[useSessionOpener] prompt-ready callback failed", error);
						});
					}
				} catch (error) {
					console.error("[useSessionOpener] prompt-ready callback failed", error);
				} finally {
					if (navigateBeforeCreate) clearOwnPendingTransition();
				}
				return true;
			};

			// 新会话没有历史需要回放。草稿迁移后先建立事件订阅并立刻派发首条 Prompt；
			// getState、上下文恢复和侧边栏对账都不再位于首条发送的关键路径。
			if (sessionPath === undefined) {
				claimNewSessionInputDraft(cachedKey, newSessionInputDraftKey(cwd));
				if (!(await subscribeForPrompt())) return;
			}

			// Fetch history + state in parallel, then commit both in one renderer job.
			// They normally land within a few milliseconds of each other; committing
			// history first caused an expensive intermediate render of the message tree.
			// allSettled preserves stage-specific diagnostics without unhandled rejection.
			perfSendMark("session-state-load-start", interactionId);
			markSessionSwitch("session-hydration-start");
			const historyPromise =
				sessionPath === undefined ? Promise.resolve([]) : window.vetta.session.getFullHistory(sessionId);
			const statePromise = window.vetta.session.getState(sessionId);
			const [historyResult, stateResult] = await Promise.allSettled([historyPromise, statePromise]);
			if (historyResult.status === "rejected") {
				failSessionHydration("history", historyResult.reason);
				return;
			}
			if (stateResult.status === "rejected") {
				failSessionHydration("state", stateResult.reason);
				return;
			}
			if (myOpenToken !== getOpenSessionToken()) {
				finishCancelledOpen();
				return;
			}
			const history = historyResult.value;
			const state = stateResult.value;
			perfSendMark("session-history-loaded", interactionId);
			markSessionSwitch("session-history-loaded");
			const mapped = reconcileOptimisticUserMessages(sessionId, fullHistoryToChat(history));
			markSessionSwitch("session-history-mapped");
			// 新会话在 subscribe 后已经允许首条消息直发，此时 sendMessage 可能已经
			// 写入乐观用户气泡。空历史没有需要恢复的内容，不能再用 [] 覆盖该气泡。
			if (sessionPath !== undefined) {
				const previewSnapshot = previewMessagesSnapshot;
				if (!previewSnapshot) {
					setChatMessages(mapped);
				} else {
					const sharedSnapshot = shareChatMessageSnapshot(previewSnapshot, mapped);
					if (sharedSnapshot.messages === previewSnapshot) {
						markSessionSwitch("session-history-commit-skipped-equivalent");
					} else {
						if (sharedSnapshot.reusedCount > 0) {
							markSessionSwitch("session-history-commit-structural-share");
						}
						setChatMessages((current) =>
							preserveMessagesAddedAfterSnapshot(previewSnapshot, sharedSnapshot.messages, current),
						);
					}
				}
			}

			perfSendMark("session-state-loaded", interactionId);
			markSessionSwitch("session-state-loaded");
			const contextComposition = resolveSessionContextComposition(resolvedSessionPath, state.contextComposition);
			setContextUsage({
				percent: state.contextPercent,
				contextTokens: state.contextTokens ?? null,
				contextWindow: state.contextWindow,
				...(contextComposition ? { composition: contextComposition } : {}),
			});
			setModelSupportsImages(state.model?.input?.includes("image") ?? false);
			setSessionExecutionMode(state.executionMode);
			// 激活工具集 → 输入栏 badge 按工具 scope 跟随显示（单一真相源）。
			setActiveToolNames(new Set(state.activeToolNames));
			// 对话场景 → 会话页插件插槽按对话类型 fail-closed 显隐。
			setCurrentScenario(state.scenario);
			// 本会话固化的工作模式 → 按会话而非全局默认值渲染（见 ADR-0046 修订）。
			// 合法值由主进程按模式注册表固化（ADR-0071），renderer 只区分「有/无」。
			setSessionAgentMode(typeof state.agentMode === "string" && state.agentMode ? state.agentMode : null);
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
				// 即使慢模型尚未产生任何可持久化 assistant 内容，也恢复一个带绝对
				// startedAt 的草稿，避免切回会话后等待态和计时从零开始。
				setChatMessages((prev) => restoreAssistantTurn(prev, startedAt));
				setActiveSessionStreaming(true);
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
			if (sessionPath !== undefined) {
				claimExistingSessionInputDraft(cachedKey, sessionPath);
			}

			// 已有会话必须先完成历史/流式草稿恢复，再接入实时事件；新会话已在上方订阅。
			if (!subscribed && !(await subscribeForPrompt())) return;
			markSessionSwitch("session-hydration-committed");
			if (stageExistingSessionOpen) clearOwnPendingTransition();
			if (isExistingSessionOpen) perfSessionSwitchComplete("completed", interactionId);

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
					const firstUser = mapped.find((m) => m.kind === "user");
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
			setPendingSessionCreation,
			setPendingSessionOpen,
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
			setSessionAgentMode,
			setSelectedModel,
			createSessionEventHandler,
			setInlineFilePreview,
			resetEventBuffers,
		],
	);

	openSessionRef.current = openSession;

	return { openSession, openSessionRef, bumpSuggestionToken };
}
