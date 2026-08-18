import type { DesktopUserQuestionRequest, DesktopUserQuestionResolvedEvent } from "@preload/api";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { FILE_EDITOR_SAVE_EVENT } from "@/shared/shortcuts";
import { useAuth } from "../domains/auth/hooks/useAuth";
import { loadNewSessionPage } from "../domains/chat/components/loadNewSessionPage";
import { useAppInit } from "../domains/chat/hooks/useAppInit";
import { useSessionManager } from "../domains/chat/hooks/useSessionManager";
import { useNotificationInit } from "../domains/message/hooks/useNotificationInit";
import { useProjectActions } from "../domains/project/hooks/useProjects";
import { useNarrowScreen } from "../shared/hooks/useNarrowScreen";
import { useRunningSessionsSync } from "../shared/hooks/useRunningSessionsSync";
import { useGlobalShortcuts } from "../shared/hooks/useShortcuts";
import { useTheme } from "../shared/hooks/useTheme";
import { useUpdaterInit } from "../shared/hooks/useUpdaterInit";
import { i18n } from "../shared/i18n";
import {
	activeSessionAtom,
	appshotAttachmentAtom,
	defaultConversationCwdAtom,
	fileEditorHasUnsavedChangesAtom,
	focusInputRequestAtom,
	lastActiveSessionAtom,
	pendingQuestionsAtom,
	projectsAtom,
	sandboxPermissionDrawerAtom,
	scheduledSessionPathsAtom,
	sidebarCollapsedAtom,
} from "../shared/store/atoms";
import { showToast } from "../shared/store/toast-atoms";
import type { RootLayoutModel } from "./types";

type SessionRestoreState = "pending" | "restoring" | "complete";

export function useRootLayoutModel(): RootLayoutModel {
	const { openProject, ensureLocalSession } = useProjectActions();
	const projects = useAtomValue(projectsAtom);
	const navigate = useNavigate();
	const setSandboxPermissionDrawer = useSetAtom(sandboxPermissionDrawerAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const activeSession = useAtomValue(activeSessionAtom);
	const setActiveSession = useSetAtom(activeSessionAtom);
	const [lastActiveSession, setLastActiveSession] = useAtom(lastActiveSessionAtom);
	const matchesForGuard = useMatches();
	const currentPath = matchesForGuard[matchesForGuard.length - 1]?.pathname ?? "/";
	const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
	const hasUnsavedFileChanges = useAtomValue(fileEditorHasUnsavedChangesAtom);
	const [sessionRestoreState, setSessionRestoreState] = useState<SessionRestoreState>("pending");
	const sessionRestoreAttemptedRef = useRef(false);
	const toggleSidebar = useCallback(() => {
		setSidebarCollapsed((v) => !v);
	}, [setSidebarCollapsed]);

	// 响应式侧边栏：窄屏时不挤压布局，改为悬浮浮层（hover 唤出，移出即隐藏）。
	const narrow = useNarrowScreen();
	const [overlayOpen, setOverlayOpen] = useState(false);
	const overlayCloseTimerRef = useRef<number | null>(null);
	const cancelOverlayClose = useCallback(() => {
		if (overlayCloseTimerRef.current != null) {
			window.clearTimeout(overlayCloseTimerRef.current);
			overlayCloseTimerRef.current = null;
		}
	}, []);
	const openOverlay = useCallback(() => {
		cancelOverlayClose();
		setOverlayOpen(true);
	}, [cancelOverlayClose]);
	const closeOverlay = useCallback(() => {
		cancelOverlayClose();
		setOverlayOpen(false);
	}, [cancelOverlayClose]);
	// 触发按钮 → 浮层之间留出短暂宽限，避免指针经过间隙时闪烁。
	const scheduleOverlayClose = useCallback(() => {
		cancelOverlayClose();
		overlayCloseTimerRef.current = window.setTimeout(() => setOverlayOpen(false), 120);
	}, [cancelOverlayClose]);
	// 退出窄屏时复位浮层状态。
	useEffect(() => {
		if (!narrow) {
			cancelOverlayClose();
			setOverlayOpen(false);
		}
	}, [narrow, cancelOverlayClose]);

	useTheme();
	useAuth();
	useAppInit();
	useNotificationInit();
	useUpdaterInit();
	// 全局 running-sessions 订阅必须挂在始终挂载的 App 上：它是 streaming 状态真值
	// 来源之一，挂在会被卸载的 Sidebar 上会在卸载期间丢 RUNNING_CHANGED 事件。
	useRunningSessionsSync();
	// 队列的出队/续发已收归主进程 kernel（ADR-0060）：followUp 在 turn 自然停止点
	// 接力消费，renderer 不再需要全局出队调度器。
	const { openSession, sendMessage } = useSessionManager();

	useEffect(() => {
		if (!hasUnsavedFileChanges) return;
		const preventClose = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", preventClose);
		return () => window.removeEventListener("beforeunload", preventClose);
	}, [hasUnsavedFileChanges]);

	// 没有待恢复会话时提前加载 NewSession 路由代码；侧栏项目/会话列表可继续独立加载。
	// 页面本身仍等路由守卫确认后再挂载，避免其初始化 effect 清除待恢复记录。
	useEffect(() => {
		if (currentPath !== "/" || activeSession || lastActiveSession) return;
		void loadNewSessionPage().catch((error: unknown) => {
			console.warn("[RootLayout] preload new session page failed", error);
		});
	}, [currentPath, activeSession, lastActiveSession]);

	// 刷新根路由时先用持久化的 cwd + sessionPath 重建 runtime session。
	// 持久化定位信息已足够恢复，无需等待默认 cwd 或侧栏历史列表完成加载。
	// runtimeId 不能跨 renderer 生命周期复用，必须重新走 openSession/session.create。
	useEffect(() => {
		if (currentPath !== "/" || sessionRestoreAttemptedRef.current) {
			return;
		}
		sessionRestoreAttemptedRef.current = true;
		if (activeSession || !lastActiveSession) {
			setSessionRestoreState("complete");
			return;
		}
		setSessionRestoreState("restoring");
		void openSession(lastActiveSession.cwd, lastActiveSession.sessionPath)
			.catch((error: unknown) => {
				console.warn("[RootLayout] restore active session failed", error);
				setActiveSession(null);
				setLastActiveSession(null);
			})
			.finally(() => setSessionRestoreState("complete"));
	}, [currentPath, activeSession, lastActiveSession, openSession, setActiveSession, setLastActiveSession]);

	// 路由守卫：仅在确认没有可恢复会话后，才跳到默认「对话」项目的 NewSession 页。
	useEffect(() => {
		if (currentPath !== "/" || activeSession || !defaultConversationCwd || sessionRestoreState !== "complete") {
			return;
		}
		void navigate({
			to: "/new-session/$cwd",
			params: { cwd: encodeURIComponent(defaultConversationCwd) },
		});
	}, [currentPath, activeSession, defaultConversationCwd, sessionRestoreState, navigate]);

	// 上报「聊天页当前所在 session」给主进程：仅在聊天路由 "/" 且有 activeSession
	// 时报其 sessionPath，否则 null。主进程据此 + 窗口聚焦态做系统通知抑制判定。
	useEffect(() => {
		const sessionPath = currentPath === "/" ? activeSession?.sessionPath || null : null;
		void window.vetta.notification.setForegroundSession(sessionPath);
	}, [currentPath, activeSession]);

	// 点击系统通知 → 主进程已前台化窗口，这里把对应 session 打开并路由到聊天页。
	useEffect(() => {
		return window.vetta.notification.onNavigate((payload) => {
			if (payload.type === "agent-turn-complete" || payload.type === "agent-question-pending") {
				void openSession(payload.cwd, payload.sessionPath);
			}
		});
	}, [openSession]);

	// 快捷面板回车 → 主进程已据 postSendBehavior 处理窗口聚焦，这里在默认「对话」目录下
	// 新建会话并直接发送 prompt（复用通知路由同款 openSession + sendMessage）。
	useEffect(() => {
		return window.vetta.quickPanel.onRunPrompt(({ text }) => {
			const cwd = defaultConversationCwd;
			if (!cwd || !text.trim()) return;
			void (async () => {
				try {
					await openSession(cwd);
					await sendMessage(text);
				} catch (error) {
					console.warn("[RootLayout] quick panel run prompt failed", error);
				}
			})();
		});
	}, [openSession, sendMessage, defaultConversationCwd]);

	useEffect(() => {
		const store = getDefaultStore();
		const unsubCaptured = window.vetta.appshot.onCaptured((payload) => {
			store.set(appshotAttachmentAtom, {
				id: payload.id,
				appName: payload.appName,
				windowTitle: payload.windowTitle,
				documentPath: payload.documentPath,
				imagePath: payload.imagePath,
				iconPath: payload.iconPath,
				textPath: payload.textPath,
				capturedAt: payload.capturedAt,
			});
			if (currentPath !== "/" && !currentPath.startsWith("/new-session") && defaultConversationCwd) {
				void navigate({
					to: "/new-session/$cwd",
					params: { cwd: encodeURIComponent(defaultConversationCwd) },
				});
			}
			store.set(focusInputRequestAtom, (previous) => previous + 1);
		});
		const unsubCaptureError = window.vetta.appshot.onCaptureError((payload) => {
			const message =
				payload.reason === "self-capture"
					? i18n.t("chat:appshot.errorSelfCapture")
					: payload.reason === "no-permission"
						? i18n.t("chat:appshot.errorNoPermission")
						: i18n.t("chat:appshot.errorHelperFailed");
			showToast({ variant: "warning", message });
		});
		return () => {
			unsubCaptured();
			unsubCaptureError();
		};
	}, [currentPath, defaultConversationCwd, navigate]);

	const confirmationQueueRef = useRef<
		Parameters<Parameters<typeof window.vetta.session.onConfirmationRequest>[0]>[0][]
	>([]);
	const confirmationActiveRef = useRef(false);

	useEffect(() => {
		const showRequest = (
			request: Parameters<Parameters<typeof window.vetta.session.onConfirmationRequest>[0]>[0],
		) => {
			confirmationActiveRef.current = true;
			const showNext = () => {
				const nextRequest = confirmationQueueRef.current.shift();
				if (nextRequest) {
					showRequest(nextRequest);
				} else {
					confirmationActiveRef.current = false;
				}
			};
			setSandboxPermissionDrawer({
				requestId: request.requestId,
				title: request.title,
				message: request.message,
				onConfirm: () => {
					void window.vetta.session.respondToConfirmation(request.requestId, true);
					setSandboxPermissionDrawer(null);
					showNext();
				},
				onCancel: () => {
					void window.vetta.session.respondToConfirmation(request.requestId, false);
					setSandboxPermissionDrawer(null);
					showNext();
				},
			});
		};
		return window.vetta.session.onConfirmationRequest((request) => {
			if (confirmationActiveRef.current) {
				confirmationQueueRef.current.push(request);
				return;
			}
			showRequest(request);
		});
	}, [setSandboxPermissionDrawer]);

	// ask_user_question：主进程持有待答真相源。Renderer 先订阅增量事件，再读取快照，
	// 让用户或 Debug Agent 回答、重载以及晚打开窗口都收敛到同一面板状态。
	const setPendingQuestions = useSetAtom(pendingQuestionsAtom);
	useEffect(() => {
		let active = true;
		const liveRequests = new Map<string, DesktopUserQuestionRequest>();
		const resolvedRequestIds = new Set<string>();

		const unsubscribeRequest = window.vetta.session.onQuestionRequest((request) => {
			liveRequests.set(request.requestId, request);
			setPendingQuestions((prev) => ({ ...prev, [request.sessionId]: request }));
		});
		const unsubscribeResolved = window.vetta.session.onQuestionResolved((event: DesktopUserQuestionResolvedEvent) => {
			resolvedRequestIds.add(event.requestId);
			liveRequests.delete(event.requestId);
			setPendingQuestions((prev) => {
				const pending = prev[event.sessionId];
				if (!pending || pending.requestId !== event.requestId) return prev;
				const next = { ...prev };
				delete next[event.sessionId];
				return next;
			});
		});

		void window.vetta.session
			.listPendingQuestions()
			.then((snapshot) => {
				if (!active) return;
				const pendingByRequestId = new Map(snapshot.map((request) => [request.requestId, request]));
				for (const [requestId, request] of liveRequests) pendingByRequestId.set(requestId, request);
				for (const requestId of resolvedRequestIds) pendingByRequestId.delete(requestId);
				const next: Record<string, DesktopUserQuestionRequest> = {};
				for (const request of pendingByRequestId.values()) next[request.sessionId] = request;
				setPendingQuestions(next);
			})
			.catch((error: unknown) => console.warn("[RootLayout] sync pending questions failed", error));

		return () => {
			active = false;
			unsubscribeRequest();
			unsubscribeResolved();
		};
	}, [setPendingQuestions]);

	const grantQueueRef = useRef<Parameters<Parameters<typeof window.vetta.session.onSandboxGrantRequest>[0]>[0][]>([]);
	const grantActiveRef = useRef(false);

	useEffect(() => {
		const showGrant = (request: Parameters<Parameters<typeof window.vetta.session.onSandboxGrantRequest>[0]>[0]) => {
			grantActiveRef.current = true;
			const showNext = () => {
				const nextRequest = grantQueueRef.current.shift();
				if (nextRequest) {
					showGrant(nextRequest);
				} else {
					grantActiveRef.current = false;
				}
			};
			setSandboxPermissionDrawer({
				requestId: request.requestId,
				title: request.title,
				message: request.message,
				sensitive: request.sensitive,
				onConfirm: () => {
					void window.vetta.session.respondToSandboxGrant(request.requestId, "allow_once");
					setSandboxPermissionDrawer(null);
					showNext();
				},
				onCancel: () => {
					void window.vetta.session.respondToSandboxGrant(request.requestId, "deny");
					setSandboxPermissionDrawer(null);
					showNext();
				},
				onAllowSession: request.sensitive
					? undefined
					: () => {
							void window.vetta.session.respondToSandboxGrant(request.requestId, "allow_session");
							setSandboxPermissionDrawer(null);
							showNext();
						},
			});
		};
		return window.vetta.session.onSandboxGrantRequest((request) => {
			if (grantActiveRef.current || confirmationActiveRef.current) {
				grantQueueRef.current.push(request);
				return;
			}
			showGrant(request);
		});
	}, [setSandboxPermissionDrawer]);

	// 调度任务（自动化）"立即执行"时，session 在 main 进程已经建好，但 JSONL
	// 要等 assistant 首个回复才落盘。这里订阅 task.started，乐观地把 session
	// 插入 sidebar，避免必须等 agent 跑完才出现的延迟。
	const setScheduledSessionPaths = useSetAtom(scheduledSessionPathsAtom);
	useEffect(() => {
		// 启动时拉取已有定时 session 路径，供侧栏识别并挂图标。
		void window.vetta.scheduler.getScheduledSessionPaths().then((paths) => {
			setScheduledSessionPaths(new Set(paths));
		});
		return window.vetta.scheduler.onTaskEvent((event) => {
			if (event.type !== "task.started") return;
			if (!event.sessionPath || !event.cwd) return;
			setScheduledSessionPaths((prev) => new Set(prev).add(event.sessionPath));
			ensureLocalSession(event.cwd, {
				id: event.sessionId,
				path: event.sessionPath,
				cwd: event.cwd,
				name: event.sessionName,
				firstMessage: event.firstMessage,
				modifiedAt: Date.now(),
			});
		});
	}, [ensureLocalSession, setScheduledSessionPaths]);

	// ─── Global keyboard shortcuts ───
	const projectsRef = useRef(projects);
	projectsRef.current = projects;

	const defaultCwdRef = useRef(defaultConversationCwd);
	defaultCwdRef.current = defaultConversationCwd;

	useGlobalShortcuts(
		useCallback(
			(actionId: string) => {
				switch (actionId) {
					case "new-session": {
						// 默认走「对话」项目的 NewSession 页面；若主进程尚未返回 cwd，退回第一个项目。
						const target = defaultCwdRef.current || projectsRef.current[0]?.cwd;
						if (target) {
							void navigate({
								to: "/new-session/$cwd",
								params: { cwd: encodeURIComponent(target) },
							});
						}
						break;
					}
					case "open-project": {
						void openProject();
						break;
					}
					case "open-settings": {
						void navigate({ to: "/settings/$tab", params: { tab: "account" } });
						break;
					}
					case "save-file": {
						window.dispatchEvent(new Event(FILE_EDITOR_SAVE_EVENT));
						break;
					}
				}
			},
			[openProject, navigate],
		),
	);

	return {
		actions: {
			closeOverlay,
			openOverlay,
			scheduleOverlayClose,
			toggleSidebar,
		},
		narrow,
		onOpenSession: openSession,
		overlayOpen,
		routePending:
			currentPath === "/" &&
			!activeSession &&
			(sessionRestoreState !== "complete" || Boolean(defaultConversationCwd)),
		sidebarCollapsed,
	};
}
