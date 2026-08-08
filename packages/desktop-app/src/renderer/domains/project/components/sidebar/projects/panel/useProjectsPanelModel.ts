import { useBatchTasks } from "@domains/batch-tasks/hooks/useBatchTasks";
import { pathBasename } from "@shared/lib/utils";
import type { SessionInfo } from "@shared/store/atoms";
import {
	activeSessionAtom,
	batchProjectsAtom,
	confirmDialogAtom,
	defaultConversationFilterAtom,
	defaultImConversationCwdAtom,
	expandedBatchProjectsAtom,
	inlineFilePreviewAtom,
} from "@shared/store/atoms";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { resolveDesktopSessionOpenTarget } from "@/shared/session-access";
import { useProjects } from "../../../../hooks/useProjects";
import type { BatchProjectEntry, ProjectsPanelModel, ProjectsPanelProps } from "./types";

const EMPTY_SESSIONS: SessionInfo[] = [];

/**
 * 侧栏只关心当前会话的 path / cwd。订阅 activeSession 整个对象会让 session 上任何字段
 * 变动（token 计数、运行状态）都把整块项目面板重渲染一遍。
 */
const activeSessionPathAtom = selectAtom(activeSessionAtom, (session) => session?.sessionPath ?? "");
const activeSessionCwdAtom = selectAtom(activeSessionAtom, (session) => session?.cwd ?? "");

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
	} = useProjects();
	const activeSessionPathValue = useAtomValue(activeSessionPathAtom);
	const activeSessionCwd = useAtomValue(activeSessionCwdAtom);
	const imCwd = useAtomValue(defaultImConversationCwdAtom);
	const setActiveSession = useSetAtom(activeSessionAtom);
	const setInlineFilePreview = useSetAtom(inlineFilePreviewAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const navigate = useNavigate();
	const matches = useMatches();
	const currentPath = matches[matches.length - 1]?.pathname ?? "/";
	const viewerParams = matches[matches.length - 1]?.params as { path?: string } | undefined;
	const viewerSessionPath = viewerParams?.path ? decodeURIComponent(viewerParams.path) : "";
	const activeSessionPath = viewerSessionPath || activeSessionPathValue;
	const batchProjects = useAtomValue(batchProjectsAtom);
	const [expandedBatchProjects, setExpandedBatchProjects] = useAtom(expandedBatchProjectsAtom);
	const { deleteTask: deleteBatchTask, deleteProject: deleteBatchProject } = useBatchTasks();
	const defaultConversationFilter = useAtomValue(defaultConversationFilterAtom);

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

	const selectSession = useCallback(
		(cwd: string, path: string) => {
			const session = sessionsMap.get(cwd)?.find((item) => item.path === path);
			const target = session?.access ? resolveDesktopSessionOpenTarget(session.access) : "interactive";
			if (target === "viewer") {
				void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(path) } });
				return;
			}
			if (target === "unavailable") return;
			void onOpenSession(cwd, path);
		},
		[onOpenSession, sessionsMap, navigate],
	);

	const selectBatchSession = useCallback(
		(_cwd: string, path: string) => {
			const task = visibleBatchProjects
				.flatMap((project) => project.tasks)
				.find((item) => item.sessionPath === path);
			if (task) void onOpenSession(task.cwd, path, task.executionMode);
		},
		[visibleBatchProjects, onOpenSession],
	);

	const defaultSelectSession = useCallback(
		(cwd: string, path: string) => {
			const session = sessionsMap.get(cwd)?.find((item) => item.path === path);
			const target = session?.access ? resolveDesktopSessionOpenTarget(session.access) : "interactive";
			if (target === "viewer") {
				void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(path) } });
				return;
			}
			if (target === "unavailable") return;
			void onOpenSession(cwd, path);
		},
		[onOpenSession, navigate, sessionsMap],
	);

	const deletePanelSession = useCallback(
		(session: { cwd: string; path: string }) => {
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
		[activeSessionPathValue, batchProjects, deleteBatchTask, deleteSession, setActiveSession, currentPath, navigate],
	);

	const renamePanelSession = useCallback(
		(cwd: string, sessionPath: string, name: string) => {
			void renameSession(cwd, sessionPath, name);
		},
		[renameSession],
	);

	const cleanupAfterProjectGone = useCallback(
		(projectCwd: string, sessionPathsInProject: string[]) => {
			const activeBelongsToProject =
				activeSessionCwd === projectCwd || sessionPathsInProject.includes(activeSessionPathValue);
			if (activeBelongsToProject) setActiveSession(null);
			const onDeletedProjectPage = currentPath === `/project/${encodeURIComponent(projectCwd)}`;
			if (onDeletedProjectPage) {
				void navigate({ to: "/" });
			}
		},
		[activeSessionCwd, activeSessionPathValue, setActiveSession, currentPath, navigate],
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
		[setConfirm, sessionsMap, activeSessionPathValue, activeSessionCwd, setActiveSession, navigate, loadSessions, t],
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
		[setConfirm, sessionsMap, imCwd, activeSessionPathValue, setActiveSession, navigate, loadSessions, t],
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
		if (defaultConversationFilter === "claw" && imCwd) {
			void loadSessions(imCwd);
		}
	}, [defaultConversationFilter, imCwd, loadSessions]);

	const defaultSessionsCwd = defaultConversationFilter === "claw" ? imCwd : defaultProject?.cwd;
	const defaultSessions = defaultSessionsCwd
		? (sessionsMap.get(defaultSessionsCwd) ?? EMPTY_SESSIONS)
		: EMPTY_SESSIONS;

	return {
		activeSessionPath,
		batchProjects: batchAsProjects,
		defaultConversationFilter,
		defaultProject,
		defaultSessions,
		defaultSessionsLoading: Boolean(
			defaultSessionsCwd && sessionLoadingCwds.has(defaultSessionsCwd) && !sessionsMap.has(defaultSessionsCwd),
		),
		expandedBatchProjects,
		expandedProjects,
		filteredProjects,
		imCwd,
		noOtherProjects,
		projectSessions: (cwd) => sessionsMap.get(cwd) ?? EMPTY_SESSIONS,
		projectSessionsLoading: (cwd) => sessionLoadingCwds.has(cwd) && !sessionsMap.has(cwd),
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
			defaultNewSession: newSession,
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
			selectSession,
		},
	};
}
