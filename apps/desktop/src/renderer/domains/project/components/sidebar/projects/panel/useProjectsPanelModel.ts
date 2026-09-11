import { useBatchTasks } from "@domains/batch-tasks/hooks/useBatchTasks";
import { notifyTeamSessionsChanged } from "@shared/agent-teams/team-session-events";
import { pathBasename } from "@shared/lib/utils";
import type { SessionInfo } from "@shared/store/atoms";
import {
	activeSessionAtom,
	batchProjectsAtom,
	confirmDialogAtom,
	conversationFilterSource,
	defaultConversationCwdAtom,
	defaultConversationFilterAtom,
	defaultImConversationCwdAtom,
	expandedBatchProjectsAtom,
	inlineFilePreviewAtom,
	pendingSessionOpenAtom,
} from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { resolveProjectGoneCleanup } from "../../../../hooks/project-gone-cleanup";
import { resolveSessionOpenTarget } from "../../../../hooks/session-open-target";
import { useProjects } from "../../../../hooks/useProjects";
import { useTeamSidebarConversations } from "../../../../hooks/useTeamSidebarConversations";
import {
	projectSidebarConversations,
	type SidebarConversationInfo,
} from "../../../../services/sidebar-conversation-projection";
import type { BatchProjectEntry, ProjectsPanelModel, ProjectsPanelProps } from "./types";

const EMPTY_SESSIONS: SessionInfo[] = [];

/**
 * 侧栏只关心当前会话的 path / cwd。订阅 activeSession 整个对象会让 session 上任何字段
 * 变动（token 计数、运行状态）都把整块项目面板重渲染一遍。
 */
const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? "");
const activeSessionCwdAtom = selectAtom(activeSessionAtom, (session) => session?.cwd ?? "");
const pendingSessionPathAtom = selectAtom(pendingSessionOpenAtom, (session) => session?.sessionPath ?? "");

export function useProjectsPanelModel({
	filter,
	onOpenSession,
}: Pick<ProjectsPanelProps, "filter" | "onOpenSession">): ProjectsPanelModel {
	const { t } = useTranslation("project");
	const {
		projects,
		projectsInitialized,
		sessionsMap,
		sessionLoadingCwds,
		expandedProjects,
		expandProject,
		collapseProject,
		deleteSession,
		renameSession,
		archiveProject,
		removeProject,
		deleteProjectFromDisk,
		loadSessions,
		removePinnedSessions,
	} = useProjects();
	const teamSidebar = useTeamSidebarConversations(projects.map((project) => project.cwd));
	const activeSessionPathValue = useAtomValue(activeSessionPathAtom);
	const pendingSessionPath = useAtomValue(pendingSessionPathAtom);
	const activeSessionCwd = useAtomValue(activeSessionCwdAtom);
	const imCwd = useAtomValue(defaultImConversationCwdAtom);
	const setActiveSession = useSetAtom(activeSessionAtom);
	const setInlineFilePreview = useSetAtom(inlineFilePreviewAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const navigate = useNavigate();
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.pathname ?? "/";
	const routeParams = matches[matches.length - 1]?.params as
		| { path?: string; cwd?: string; sessionId?: string }
		| undefined;
	const viewerSessionPath = routeParams?.path ? decodeURIComponent(routeParams.path) : "";
	/** `/project/$cwd` 与 `/new-session/$cwd` 的参数值本身是编码过的（见导航处的 encodeURIComponent）。 */
	const routeCwd = routeParams?.cwd ? decodeURIComponent(routeParams.cwd) : "";
	const activeSessionPath = viewerSessionPath || pendingSessionPath || activeSessionPathValue;
	const activeTeamSessionId =
		currentPath.startsWith("/agent-teams/") && routeParams?.sessionId
			? decodeURIComponent(routeParams.sessionId)
			: "";
	const batchProjects = useAtomValue(batchProjectsAtom);
	const [expandedBatchProjects, setExpandedBatchProjects] = useAtom(expandedBatchProjectsAtom);
	const { deleteTask: deleteBatchTask, deleteProject: deleteBatchProject } = useBatchTasks();
	const defaultConversationFilter = useAtomValue(defaultConversationFilterAtom);
	const setDefaultConversationFilter = useSetAtom(defaultConversationFilterAtom);
	// 标签档只是「对话」的一个子集视图，会话来源仍取普通对话目录。
	const defaultConversationSource = conversationFilterSource(defaultConversationFilter);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);

	const expandBatchProject = useCallback(
		(cwd: string) => {
			setExpandedBatchProjects((prev) => {
				if (prev.has(cwd)) return prev;
				const next = new Set(prev);
				next.add(cwd);
				return next;
			});
		},
		[setExpandedBatchProjects],
	);

	const collapseBatchProject = useCallback(
		(cwd: string) => {
			setExpandedBatchProjects((prev) => {
				if (!prev.has(cwd)) return prev;
				const next = new Set(prev);
				next.delete(cwd);
				return next;
			});
		},
		[setExpandedBatchProjects],
	);

	const visibleBatchProjects = useMemo(
		() => batchProjects.filter((project) => project.tasks.some((task) => task.sessionPath)),
		[batchProjects],
	);

	const batchAsProjects = useMemo<BatchProjectEntry[]>(
		() =>
			visibleBatchProjects.map((batchProject) => {
				const tasksWithSession = batchProject.tasks.filter((task) => task.sessionPath);
				return {
					project: {
						cwd: batchProject.id,
						name: batchProject.name,
						sessionCount: tasksWithSession.length,
						type: "batch",
					},
					sessions: tasksWithSession.map((task) => ({
						kind: "conversation" as const,
						id: task.id,
						path: task.sessionPath!,
						cwd: task.cwd,
						name: task.name || undefined,
						firstMessage: task.name || task.id,
						modifiedAt: task.updatedAt,
					})),
				};
			}),
		[visibleBatchProjects],
	);

	const showBatchGroup = filter === "all" || filter === "batch";
	const defaultProject = useMemo(() => projects.find((project) => project.isDefault), [projects]);
	// 默认区的会话来源 cwd：claw 过滤读 im-gateway 自己的 cwd（ADR-0005），
	// 与 defaultProject.cwd 是两个物理目录，选中 / 重命名都必须用这个值。
	const defaultSessionsCwd = defaultConversationSource === "claw" ? imCwd : defaultProject?.cwd;
	const filteredProjects = useMemo(() => {
		const visible = projects.filter((project) => project.type !== "batch" && !project.isDefault);
		if (filter === "all") return visible;
		return visible.filter((project) => project.type === filter);
	}, [projects, filter]);

	const navigateProject = useCallback(
		(cwd: string) => {
			void (async () => {
				setInlineFilePreview(null);
				await navigate({ to: "/project/$cwd", params: { cwd: encodeURIComponent(cwd) } });
				setActiveSession(null);
			})();
		},
		[navigate, setActiveSession, setInlineFilePreview],
	);

	const newSession = useCallback(
		(cwd: string) => {
			void navigate({ to: "/new-session/$cwd", params: { cwd: encodeURIComponent(cwd) } });
		},
		[navigate],
	);

	/**
	 * 标签档下新建的会话不属于任何标签，留在原档位用户会看不到自己刚建的会话，
	 * 以为没建成；因此先切回「对话」再新建。
	 */
	const defaultNewSession = useCallback(
		(cwd: string) => {
			setDefaultConversationFilter("conversation");
			newSession(cwd);
		},
		[newSession, setDefaultConversationFilter],
	);

	// sessionsMap 每次 listSessions 回填都会换 Map 引用。openSessionByTarget 作为
	// onSelectSession 传进每个 memo 的 ProjectGroup，若直接依赖 sessionsMap，任意一次
	// 回填都会击穿所有项目组的 memo。事件回调只在点击时才需要最新值，走 ref 读取。
	const sessionsMapRef = useRef(sessionsMap);
	useEffect(() => {
		sessionsMapRef.current = sessionsMap;
	}, [sessionsMap]);

	const openSessionByTarget = useCallback(
		(cwd: string, path: string) => {
			const target = resolveSessionOpenTarget(sessionsMapRef.current.get(cwd), path);
			if (target === "viewer") {
				void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(path) } });
				return;
			}
			if (target === "unavailable") return;
			void onOpenSession(cwd, path);
		},
		[onOpenSession, navigate],
	);

	const selectSidebarSession = useCallback(
		(cwd: string, session: SidebarConversationInfo) => {
			if (session.kind === "agent-team") {
				void navigate({
					to: "/agent-teams/$teamId/sessions/$sessionId",
					params: { teamId: session.teamId, sessionId: session.teamSessionId },
				});
				return;
			}
			openSessionByTarget(cwd, session.path);
		},
		[navigate, openSessionByTarget],
	);

	const selectBatchSession = useCallback(
		(_cwd: string, session: SidebarConversationInfo) => {
			const task = visibleBatchProjects
				.flatMap((project) => project.tasks)
				.find((item) => item.sessionPath === session.path);
			if (task) void onOpenSession(task.cwd, session.path, task.executionMode);
		},
		[visibleBatchProjects, onOpenSession],
	);

	// 默认区（含 claw）与项目区共用同一套判定；cwd 由 defaultSessionsCwd 逐层传下，
	// 保证查 access 用的是会话真正所属的 cwd。
	const defaultSelectSession = selectSidebarSession;

	const deletePanelSession = useCallback(
		(session: SidebarConversationInfo) => {
			if (session.kind === "agent-team") {
				const wasActive = activeTeamSessionId === session.teamSessionId;
				void window.vetta.agentTeams
					.deleteSession({ id: session.teamSessionId, coordinationSessionPath: session.path })
					.then(() => {
						notifyTeamSessionsChanged(session.teamId);
						if (wasActive) void navigate({ to: "/" });
					});
				return;
			}
			const wasActive = activeSessionPathValue === session.path;
			const goToProjectDetail = (projectCwd: string): void => {
				if (!wasActive) return;
				setActiveSession(null);
				if (currentPath === "/") {
					void navigate({ to: "/new-session/$cwd", params: { cwd: encodeURIComponent(projectCwd) } });
				}
			};
			const batchMatch = batchProjects.find((project) =>
				project.tasks.some((task) => task.sessionPath === session.path),
			);
			if (batchMatch) {
				const task = batchMatch.tasks.find((item) => item.sessionPath === session.path);
				if (task) {
					void deleteBatchTask(batchMatch.id, task.id);
					goToProjectDetail(batchMatch.id);
					return;
				}
			}
			void deleteSession(session.cwd, session.path);
			goToProjectDetail(session.cwd);
		},
		[
			activeSessionPathValue,
			activeTeamSessionId,
			batchProjects,
			deleteBatchTask,
			deleteSession,
			setActiveSession,
			currentPath,
			navigate,
		],
	);

	const renamePanelSession = useCallback(
		(cwd: string, sessionPath: string, name: string) => {
			void renameSession(cwd, sessionPath, name);
		},
		[renameSession],
	);

	const cleanupAfterProjectGone = useCallback(
		(projectCwd: string, sessionPathsInProject: string[]) => {
			const { clearActiveSession, navigation } = resolveProjectGoneCleanup(projectCwd, sessionPathsInProject, {
				currentPath,
				routeCwd,
				routeSessionPath: viewerSessionPath,
				activeSessionCwd,
				activeSessionPath: activeSessionPathValue,
				defaultConversationCwd,
			});
			if (clearActiveSession) setActiveSession(null);
			if (navigation.kind === "new-session") {
				void navigate({ to: "/new-session/$cwd", params: { cwd: encodeURIComponent(navigation.cwd) } });
				return;
			}
			if (navigation.kind === "home") void navigate({ to: "/" });
		},
		[
			activeSessionCwd,
			activeSessionPathValue,
			setActiveSession,
			currentPath,
			routeCwd,
			viewerSessionPath,
			defaultConversationCwd,
			navigate,
		],
	);

	const confirmDeleteBatchProject = useCallback(
		(batch: (typeof batchProjects)[number]) => {
			const taskPaths = batch.tasks.map((task) => task.sessionPath).filter((path): path is string => Boolean(path));
			setConfirm({
				title: t("sidebar.dialogs.deleteBatchTitle"),
				message: t("sidebar.dialogs.deleteBatchMessage", { name: batch.name }),
				confirmLabel: t("sidebar.dialogs.deleteConfirm"),
				variant: "danger",
				onConfirm: async () => {
					await deleteBatchProject(batch.id);
					cleanupAfterProjectGone(batch.id, taskPaths);
				},
			});
		},
		[cleanupAfterProjectGone, deleteBatchProject, setConfirm, t],
	);

	const removePanelProject = useCallback(
		(cwd: string) => {
			const batch = batchProjects.find((project) => project.id === cwd);
			if (batch) {
				confirmDeleteBatchProject(batch);
				return;
			}
			const project = projects.find((item) => item.cwd === cwd);
			const displayName = project?.name ?? pathBasename(cwd);
			const sessionPaths = (sessionsMap.get(cwd) ?? []).map((session) => session.path);
			setConfirm({
				title: t("sidebar.dialogs.removeTitle"),
				message: t("sidebar.dialogs.removeMessage", { name: displayName }),
				confirmLabel: t("sidebar.dialogs.removeConfirm"),
				variant: "default",
				onConfirm: async () => {
					await removeProject(cwd);
					cleanupAfterProjectGone(cwd, sessionPaths);
				},
			});
		},
		[
			batchProjects,
			confirmDeleteBatchProject,
			projects,
			sessionsMap,
			setConfirm,
			t,
			removeProject,
			cleanupAfterProjectGone,
		],
	);

	const deletePanelProject = useCallback(
		(cwd: string) => {
			const batch = batchProjects.find((project) => project.id === cwd);
			if (batch) {
				confirmDeleteBatchProject(batch);
				return;
			}
			const project = projects.find((item) => item.cwd === cwd);
			const displayName = project?.name ?? pathBasename(cwd);
			const sessionPaths = (sessionsMap.get(cwd) ?? []).map((session) => session.path);
			setConfirm({
				title: t("sidebar.dialogs.deleteProjectTitle"),
				message: t("sidebar.dialogs.deleteProjectMessage", { name: displayName }),
				confirmLabel: t("sidebar.dialogs.deleteConfirm"),
				variant: "danger",
				onConfirm: async () => {
					await deleteProjectFromDisk(cwd);
					cleanupAfterProjectGone(cwd, sessionPaths);
				},
			});
		},
		[
			batchProjects,
			confirmDeleteBatchProject,
			projects,
			sessionsMap,
			setConfirm,
			t,
			deleteProjectFromDisk,
			cleanupAfterProjectGone,
		],
	);

	const clearConversation = useCallback(
		(cwd: string) => {
			const allSessions = sessionsMap.get(cwd) ?? [];
			setConfirm({
				title: t("sidebar.dialogs.clearConversationTitle"),
				message: t("sidebar.dialogs.clearConversationMessage", { count: allSessions.length }),
				confirmLabel: t("sidebar.dialogs.clearConfirm"),
				variant: "danger",
				onConfirm: async () => {
					await window.vetta.session.clearDefaultConversation("conversation");
					const removedPaths = new Set(allSessions.map((session) => session.path));
					removePinnedSessions(removedPaths);
					if (removedPaths.has(activeSessionPathValue) || (activeSessionCwd === cwd && !removedPaths.size)) {
						setActiveSession(null);
						void navigate({
							to: "/new-session/$cwd",
							params: { cwd: encodeURIComponent(cwd) },
						});
					}
					await loadSessions(cwd);
				},
			});
		},
		[
			setConfirm,
			sessionsMap,
			activeSessionPathValue,
			activeSessionCwd,
			setActiveSession,
			navigate,
			loadSessions,
			removePinnedSessions,
			t,
		],
	);

	const clearClaw = useCallback(
		(cwd: string) => {
			const imSessions = sessionsMap.get(imCwd) ?? [];
			setConfirm({
				title: t("sidebar.dialogs.clearClawTitle"),
				message: t("sidebar.dialogs.clearClawMessage", { count: imSessions.length }),
				confirmLabel: t("sidebar.dialogs.clearConfirm"),
				variant: "danger",
				onConfirm: async () => {
					await window.vetta.session.clearDefaultConversation("claw");
					const removedPaths = new Set(imSessions.map((session) => session.path));
					removePinnedSessions(removedPaths);
					if (removedPaths.has(activeSessionPathValue)) {
						setActiveSession(null);
						void navigate({
							to: "/new-session/$cwd",
							params: { cwd: encodeURIComponent(cwd) },
						});
					}
					if (imCwd) await loadSessions(imCwd);
				},
			});
		},
		[
			setConfirm,
			sessionsMap,
			imCwd,
			activeSessionPathValue,
			setActiveSession,
			navigate,
			loadSessions,
			removePinnedSessions,
			t,
		],
	);

	const activeProjectCandidates = useMemo(() => {
		if (!currentPath.startsWith("/project/")) return new Set<string>();
		const raw = currentPath.slice("/project/".length);
		if (!raw) return new Set<string>();
		const variants = new Set<string>([raw]);
		let value = raw;
		for (let i = 0; i < 3; i++) {
			try {
				const decoded = decodeURIComponent(value);
				if (decoded === value) break;
				variants.add(decoded);
				value = decoded;
			} catch {
				break;
			}
		}
		return variants;
	}, [currentPath]);

	const isProjectActive = useCallback((cwd: string) => activeProjectCandidates.has(cwd), [activeProjectCandidates]);

	const noOtherProjects = filteredProjects.length === 0 && (!showBatchGroup || batchAsProjects.length === 0);

	useEffect(() => {
		if (defaultConversationSource === "claw" && imCwd) {
			void loadSessions(imCwd);
		}
	}, [defaultConversationSource, imCwd, loadSessions]);

	const ordinaryDefaultSessions = defaultSessionsCwd
		? (sessionsMap.get(defaultSessionsCwd) ?? EMPTY_SESSIONS)
		: EMPTY_SESSIONS;
	const defaultSessions = useMemo(
		() =>
			projectSidebarConversations(
				ordinaryDefaultSessions,
				defaultConversationSource === "conversation" ? teamSidebar.conversations : [],
				{ kind: "default" },
			),
		[defaultConversationSource, ordinaryDefaultSessions, teamSidebar.conversations],
	);
	const projectSidebarSessions = useMemo(() => {
		const result = new Map<string, SidebarConversationInfo[]>();
		for (const project of filteredProjects) {
			result.set(
				project.cwd,
				projectSidebarConversations(sessionsMap.get(project.cwd) ?? EMPTY_SESSIONS, teamSidebar.conversations, {
					kind: "project",
					projectPath: project.cwd,
				}),
			);
		}
		return result;
	}, [filteredProjects, sessionsMap, teamSidebar.conversations]);
	useEffect(() => {
		if (!activeTeamSessionId) return;
		for (const [cwd, sessions] of projectSidebarSessions) {
			if (
				!expandedProjects.has(cwd) &&
				sessions.some((session) => session.kind === "agent-team" && session.teamSessionId === activeTeamSessionId)
			) {
				expandProject(cwd);
				return;
			}
		}
	}, [activeTeamSessionId, expandProject, expandedProjects, projectSidebarSessions]);

	return {
		activeSessionPath,
		activeTeamSessionId,
		batchProjects: batchAsProjects,
		defaultConversationFilter,
		defaultProject,
		defaultSessions,
		defaultSessionsCwd: defaultSessionsCwd ?? "",
		defaultSessionsLoading:
			Boolean(
				defaultSessionsCwd && sessionLoadingCwds.has(defaultSessionsCwd) && !sessionsMap.has(defaultSessionsCwd),
			) ||
			(defaultConversationSource === "conversation" && teamSidebar.loading),
		expandedBatchProjects,
		expandedProjects,
		filteredProjects,
		imCwd,
		noOtherProjects,
		projectSessions: (cwd) => projectSidebarSessions.get(cwd) ?? [],
		projectSessionsLoading: (cwd) => (sessionLoadingCwds.has(cwd) && !sessionsMap.has(cwd)) || teamSidebar.loading,
		projectsLoading: !projectsInitialized,
		showBatchGroup,
		actions: {
			archiveProject: (cwd) => {
				void archiveProject(cwd);
			},
			batchNewSession: newSession,
			clearClaw,
			clearConversation,
			collapseBatchProject,
			collapseProject,
			deleteProject: deletePanelProject,
			deleteSession: deletePanelSession,
			defaultNewSession,
			defaultSelectSession,
			expandBatchProject,
			expandProject,
			isProjectActive,
			navigateProject,
			openClawSettings: () => {
				void navigate({ to: "/settings/$tab", params: { tab: "im" } });
			},
			removeProject: removePanelProject,
			renameSession: renamePanelSession,
			selectBatchSession,
			selectSession: selectSidebarSession,
		},
	};
}
