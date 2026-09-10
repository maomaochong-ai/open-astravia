import { useRefreshBatchProjects } from "@shared/hooks/useRefreshBatchProjects";
import {
	DEFAULT_CONVERSATION_PROJECT_NAME,
	defaultConversationCwdAtom,
	defaultImConversationCwdAtom,
	expandedProjectsAtom,
	NO_MESSAGES_SENTINEL,
	type Project,
	type ProjectType,
	projectsAtom,
	projectsInitializedAtom,
	type SessionInfo,
	scheduledRecordsVersionAtom,
	scheduledSessionPathsAtom,
	sessionLoadingCwdsAtom,
	sessionsMapAtom,
	workspacePathAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

/** firstMessage 是否可直接当展示名（排除空串与 coding-agent 占位）。 */
function isUsableFirstMessage(text: string | undefined): boolean {
	const t = (text ?? "").trim();
	return t.length > 0 && t !== NO_MESSAGES_SENTINEL;
}

// Module-level flag so auto-expand only happens once per app session
let didAutoExpand = false;

// Module-level guard so the IM session-changed subscription only runs once
// per renderer (useProjects is called from many components). The subscriber
// reloads the default "对话" project's session list whenever the sidecar
// emits a state_patch (i.e. an IM message just created or updated a session).
let imSubscribed = false;
let sessionListSubscribed = false;
const sessionLoadPromises = new Map<string, Promise<void>>();

export function useProjects() {
	const [projects, setProjects] = useAtom(projectsAtom);
	const [projectsInitialized, setProjectsInitialized] = useAtom(projectsInitializedAtom);
	const [sessionsMap, setSessionsMap] = useAtom(sessionsMapAtom);
	const [sessionLoadingCwds, setSessionLoadingCwds] = useAtom(sessionLoadingCwdsAtom);
	const scheduledSessionPaths = useAtomValue(scheduledSessionPathsAtom);
	const setScheduledSessionPaths = useSetAtom(scheduledSessionPathsAtom);
	const setScheduledRecordsVersion = useSetAtom(scheduledRecordsVersionAtom);
	const [expandedProjects, setExpandedProjects] = useAtom(expandedProjectsAtom);
	const workspacePath = useAtomValue(workspacePathAtom);
	const defaultConversationCwd = useAtomValue(defaultConversationCwdAtom);
	const defaultImConversationCwd = useAtomValue(defaultImConversationCwdAtom);
	const refreshBatchProjects = useRefreshBatchProjects();

	const loadSessions = useCallback(
		(cwd: string): Promise<void> => {
			const activeLoad = sessionLoadPromises.get(cwd);
			if (activeLoad) return activeLoad;
			setSessionLoadingCwds((prev) => new Set(prev).add(cwd));
			const loadPromise = window.astravia.session
				.listSessions(cwd)
				.then((sessions: SessionInfo[]) =>
					setSessionsMap((prev) => {
						// 定时 / 新建 session 的 name、以及发送瞬间写入的乐观 firstMessage，在 assistant
						// 首条落盘前磁盘可能仍是空 name + "(no messages)"。若直接覆盖会让侧栏/标题
						// 闪回「未命名会话」。用上一次已知的非空 name / 可用 firstMessage 兜底。
						const prevByPath = new Map((prev.get(cwd) ?? []).map((s) => [s.path, s]));
						const merged = sessions.map((s) => {
							const known = prevByPath.get(s.path);
							if (!known) return s;
							let next = s;
							if (!s.name && known.name) {
								next = { ...next, name: known.name };
							}
							if (!isUsableFirstMessage(s.firstMessage) && isUsableFirstMessage(known.firstMessage)) {
								next = { ...next, firstMessage: known.firstMessage };
							}
							return next;
						});
						return new Map([...prev, [cwd, merged]]);
					}),
				)
				.finally(() => {
					sessionLoadPromises.delete(cwd);
					setSessionLoadingCwds((prev) => {
						const next = new Set(prev);
						next.delete(cwd);
						return next;
					});
				});
			sessionLoadPromises.set(cwd, loadPromise);
			return loadPromise;
		},
		[setSessionLoadingCwds, setSessionsMap],
	);

	// Keep a ref to loadSessions so the IM subscription (set up once at module
	// scope via imSubscribed) always calls the latest closure.
	const loadSessionsRef = useRef(loadSessions);
	loadSessionsRef.current = loadSessions;
	const defaultCwdRef = useRef(defaultConversationCwd);
	defaultCwdRef.current = defaultConversationCwd;
	const imCwdRef = useRef(defaultImConversationCwd);
	imCwdRef.current = defaultImConversationCwd;
	const expandedProjectsRef = useRef(expandedProjects);
	expandedProjectsRef.current = expandedProjects;
	useEffect(() => {
		if (!imSubscribed) {
			imSubscribed = true;
			window.astravia.im.onSessionChanged(() => {
				// Claw 会话写在独立的 IM cwd 下（ADR-0005），fs watcher 监听的也是它；
				// 桌面「对话」cwd 不会被 sidecar 写，但保留刷新以兼容历史路径。
				const imCwd = imCwdRef.current;
				if (imCwd) void loadSessionsRef.current(imCwd);
				const cwd = defaultCwdRef.current;
				if (cwd && cwd !== imCwd) void loadSessionsRef.current(cwd);
			});
		}
		if (!sessionListSubscribed) {
			sessionListSubscribed = true;
			window.astravia.session.onSessionsChanged(({ cwd, sessionPath, session }) => {
				if (session && isUsableFirstMessage(session.firstMessage)) {
					setSessionsMap((prev) => {
						const sessions = prev.get(cwd) ?? [];
						const existingIndex = sessions.findIndex((item) => item.path === sessionPath);
						const nextSessions = sessions.slice();
						if (existingIndex === -1) {
							nextSessions.unshift({
								id: session.id,
								path: sessionPath,
								cwd: session.cwd,
								firstMessage: session.firstMessage,
								modifiedAt: session.modifiedAt,
							});
						} else {
							const existing = nextSessions[existingIndex];
							nextSessions[existingIndex] = {
								...existing,
								firstMessage: isUsableFirstMessage(existing.firstMessage)
									? existing.firstMessage
									: session.firstMessage,
								modifiedAt: Math.max(existing.modifiedAt, session.modifiedAt),
							};
						}
						return new Map([...prev, [cwd, nextSessions]]);
					});
				}
				void loadSessionsRef.current(cwd);
			});
		}
		// Intentionally no cleanup: the listener lives for the renderer's
		// lifetime, mirroring the singleton-style hooks (useAppInit, etc.).
	}, [setSessionsMap]);

	const refreshProjects = useCallback(async () => {
		try {
			// Read project list from app-specific config file (not shared with CLI)
			const config = await window.astravia.config.get();
			const entries = config.projects.map((entry) => ({ cwd: entry.path, name: entry.name, sessionCount: 0 }));

			// Read meta.json for each project in parallel to determine type
			const metaResults = await Promise.all(
				entries.map(async (entry) => {
					const meta = await window.astravia.project.readMeta(entry.cwd);
					const rawType = meta?.type as string | undefined;
					const type: ProjectType = rawType === "batch" ? rawType : "normal";
					return { ...entry, type };
				}),
			);

			// 虚拟注入默认「对话」项目，置于最前，且过滤掉用户误手动加入的同名条目。
			const defaultCwd = config.defaultConversationCwd ?? "";
			const filtered = defaultCwd ? metaResults.filter((p) => p.cwd !== defaultCwd) : metaResults;
			const all: Project[] = defaultCwd
				? [
						{
							cwd: defaultCwd,
							name: DEFAULT_CONVERSATION_PROJECT_NAME,
							sessionCount: 0,
							type: "normal" as const,
							isDefault: true,
						},
						...filtered,
					]
				: filtered;
			setProjects(all);

			// 首屏只加载默认会话与已展开项目；其它项目在展开时局部加载。
			const projectCwds = new Set(all.map((project) => project.cwd));
			const cwdsToLoad = new Set([...expandedProjectsRef.current].filter((cwd) => projectCwds.has(cwd)));
			if (defaultCwd) cwdsToLoad.add(defaultCwd);

			if (!didAutoExpand && all.length > 0) {
				didAutoExpand = true;
				setExpandedProjects(new Set<string>([all[0].cwd]));
				cwdsToLoad.add(all[0].cwd);
			}
			for (const cwd of cwdsToLoad) void loadSessions(cwd);
		} finally {
			setProjectsInitialized(true);
		}
	}, [loadSessions, setExpandedProjects, setProjects, setProjectsInitialized]);

	/** Create a new project directory in workspace and add to config; returns resolved cwd. */
	const createProject = useCallback(
		async (name: string): Promise<string> => {
			const projectPath = `${workspacePath}/${name}`;
			await window.astravia.fs.createDirectory(projectPath);
			// Read the resolved path back via listSubDirs to get the absolute path
			const subDirs = await window.astravia.fs.listSubDirs(workspacePath);
			const created = subDirs.find((d) => d.name === name);
			const resolvedPath = created?.path ?? projectPath;

			// Add to config with the user-provided name
			const config = await window.astravia.config.get();
			if (!config.projects.some((p) => p.path === resolvedPath)) {
				config.projects.push({ path: resolvedPath, name });
				await window.astravia.config.set({ projects: config.projects });
			}

			await refreshProjects();
			setExpandedProjects((prev) => new Set([...prev, resolvedPath]));
			return resolvedPath;
		},
		[workspacePath, refreshProjects, setExpandedProjects],
	);

	/** Open an existing directory and add to config */
	const openProject = useCallback(async () => {
		const cwd = await window.astravia.dialog.selectFolder();
		if (!cwd) return null;

		const config = await window.astravia.config.get();
		if (!config.projects.some((p) => p.path === cwd)) {
			config.projects.push({ path: cwd });
			await window.astravia.config.set({ projects: config.projects });
		}

		await refreshProjects();
		await refreshBatchProjects();
		setExpandedProjects((prev) => new Set([...prev, cwd]));
		await loadSessions(cwd);
		return cwd;
	}, [refreshProjects, refreshBatchProjects, setExpandedProjects, loadSessions]);

	const expandProject = useCallback(
		(cwd: string) => {
			setExpandedProjects((prev) => {
				if (prev.has(cwd)) return prev;
				void loadSessions(cwd);
				const next = new Set(prev);
				next.add(cwd);
				return next;
			});
		},
		[setExpandedProjects, loadSessions],
	);

	const collapseProject = useCallback(
		(cwd: string) => {
			setExpandedProjects((prev) => {
				if (!prev.has(cwd)) return prev;
				const next = new Set(prev);
				next.delete(cwd);
				return next;
			});
		},
		[setExpandedProjects],
	);

	const toggleProject = useCallback(
		(cwd: string) => {
			setExpandedProjects((prev) => {
				if (prev.has(cwd)) {
					const next = new Set(prev);
					next.delete(cwd);
					return next;
				}
				void loadSessions(cwd);
				const next = new Set(prev);
				next.add(cwd);
				return next;
			});
		},
		[setExpandedProjects, loadSessions],
	);

	const removeProject = useCallback(
		async (cwd: string) => {
			// 默认「对话」项目不允许从列表中移除。
			if (cwd === defaultConversationCwd) return;
			const config = await window.astravia.config.get();
			config.projects = config.projects.filter((p) => p.path !== cwd);
			await window.astravia.config.set({ projects: config.projects });
			await refreshProjects();
		},
		[refreshProjects, defaultConversationCwd],
	);

	const archiveProject = useCallback(
		async (cwd: string) => {
			if (cwd === defaultConversationCwd) return;
			const config = await window.astravia.config.get();
			const entry = config.projects.find((p) => p.path === cwd);
			config.projects = config.projects.filter((p) => p.path !== cwd);
			const archived = config.archivedProjects ?? [];
			if (!archived.some((p) => p.path === cwd)) {
				archived.push(entry ?? { path: cwd });
			}
			await window.astravia.config.set({ projects: config.projects, archivedProjects: archived });
			await refreshProjects();
		},
		[refreshProjects, defaultConversationCwd],
	);

	const unarchiveProject = useCallback(
		async (cwd: string) => {
			const config = await window.astravia.config.get();
			const archived = (config.archivedProjects ?? []).filter((p) => p.path !== cwd);
			const projects = config.projects.some((p) => p.path === cwd)
				? config.projects
				: [...config.projects, { path: cwd }];
			await window.astravia.config.set({ projects, archivedProjects: archived });
			await refreshProjects();
		},
		[refreshProjects],
	);

	const deleteArchivedProject = useCallback(async (cwd: string) => {
		const config = await window.astravia.config.get();
		const archived = (config.archivedProjects ?? []).filter((p) => p.path !== cwd);
		await window.astravia.config.set({ archivedProjects: archived });
	}, []);

	/** Remove project from config AND delete from disk */
	const deleteProjectFromDisk = useCallback(
		async (cwd: string) => {
			if (cwd === defaultConversationCwd) return;
			const config = await window.astravia.config.get();
			config.projects = config.projects.filter((p) => p.path !== cwd);
			const archived = (config.archivedProjects ?? []).filter((p) => p.path !== cwd);
			await window.astravia.config.set({ projects: config.projects, archivedProjects: archived });
			await window.astravia.fs.delete(cwd);
			await refreshProjects();
		},
		[refreshProjects, defaultConversationCwd],
	);

	const deleteSession = useCallback(
		async (_cwd: string, sessionPath: string) => {
			await window.astravia.session.delete(sessionPath);
			// 定时任务 session：同步删掉「自动化」里的执行记录，否则历史列表会残留。
			if (scheduledSessionPaths.has(sessionPath)) {
				await window.astravia.scheduler.deleteRecordsBySession(sessionPath);
				setScheduledSessionPaths((prev) => {
					if (!prev.has(sessionPath)) return prev;
					const next = new Set(prev);
					next.delete(sessionPath);
					return next;
				});
				// 驱动正在展示的执行历史重新拉取。
				setScheduledRecordsVersion((v) => v + 1);
			}
			setSessionsMap((prev) => {
				// ADR-0007: 「对话」项目下的 session.cwd 是 per-session 子目录，但
				// sessionsMap 的 key 仍是项目根。这里不再用传入的 cwd 反查，而是
				// 遍历所有桶把命中 sessionPath 的条目摘掉，避免侧栏不刷新。
				const next = new Map(prev);
				for (const [key, sessions] of prev) {
					const filtered = sessions.filter((s) => s.path !== sessionPath);
					if (filtered.length !== sessions.length) next.set(key, filtered);
				}
				return next;
			});
		},
		[setSessionsMap, scheduledSessionPaths, setScheduledSessionPaths, setScheduledRecordsVersion],
	);

	/**
	 * 保证本地 sessionsMap 有该 session 条目。
	 * - 不存在：插入（用于首条 prompt 发出时，JSONL 尚未含用户消息）。
	 * - 已存在但 name/firstMessage 仍是空或 "(no messages)"：用 info 补齐，
	 *   避免侧栏/标题卡在「未命名会话」（openSession 后 listSessions 常先写占位行）。
	 * 已有真实 name 的条目不覆盖。
	 */
	const ensureLocalSession = useCallback(
		(cwd: string, info: SessionInfo) => {
			setSessionsMap((prev) => {
				const sessions = prev.get(cwd) ?? [];
				const idx = sessions.findIndex((s) => s.path === info.path);
				if (idx < 0) {
					const next = new Map(prev);
					next.set(cwd, [...sessions, info]);
					return next;
				}
				const existing = sessions[idx];
				const patchFirst = !isUsableFirstMessage(existing.firstMessage) && isUsableFirstMessage(info.firstMessage);
				const patchName = !existing.name && !!info.name;
				if (!patchFirst && !patchName) {
					// 仍刷新 modifiedAt，让侧栏排序贴近「刚发过消息」。
					if (info.modifiedAt <= existing.modifiedAt) return prev;
					const updated = sessions.slice();
					updated[idx] = { ...existing, modifiedAt: info.modifiedAt };
					const next = new Map(prev);
					next.set(cwd, updated);
					return next;
				}
				const updated = sessions.slice();
				updated[idx] = {
					...existing,
					firstMessage: patchFirst ? info.firstMessage : existing.firstMessage,
					name: patchName ? info.name : existing.name,
					modifiedAt: Math.max(existing.modifiedAt, info.modifiedAt),
				};
				const next = new Map(prev);
				next.set(cwd, updated);
				return next;
			});
		},
		[setSessionsMap],
	);

	const applyLocalRename = useCallback(
		(cwd: string, sessionPath: string, name: string) => {
			setSessionsMap((prev) => {
				const next = new Map(prev);
				const sessions = next.get(cwd);
				if (sessions) {
					next.set(
						cwd,
						sessions.map((s) => (s.path === sessionPath ? { ...s, name } : s)),
					);
				}
				return next;
			});
		},
		[setSessionsMap],
	);

	const renameSession = useCallback(
		async (cwd: string, sessionPath: string, name: string) => {
			await window.astravia.session.rename(sessionPath, name);
			applyLocalRename(cwd, sessionPath, name);
		},
		[applyLocalRename],
	);

	return {
		projects,
		projectsInitialized,
		sessionsMap,
		sessionLoadingCwds,
		expandedProjects,
		refreshProjects,
		loadSessions,
		createProject,
		openProject,
		removeProject,
		archiveProject,
		unarchiveProject,
		deleteArchivedProject,
		deleteProjectFromDisk,
		expandProject,
		collapseProject,
		toggleProject,
		deleteSession,
		renameSession,
		applyLocalRename,
		ensureLocalSession,
	};
}
