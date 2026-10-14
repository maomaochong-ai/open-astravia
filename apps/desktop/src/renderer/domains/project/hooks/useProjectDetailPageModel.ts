import { isMac } from "@shared/lib/platform";
import { pathBasename } from "@shared/lib/utils";
import { useShortcutScope } from "@shared/shortcuts";
import {
	activityPanelOpenAtom,
	batchProjectsAtom,
	confirmDialogAtom,
	isPersonalModeAtom,
	pageHeaderTitleHiddenAtom,
	pinnedSessionPathsAtom,
	projectsAtom,
	resolvedThemeAtom,
	runningSessionPathsAtom,
	runningTaskIdsAtom,
	type SessionInfo,
	scheduledTasksAtom,
	sessionDisplayLabel,
	sessionsMapAtom,
} from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { ProjectDetailPageViewProps } from "@vetta-org/theme-ui/project";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveSessionOpenTarget } from "./session-open-target";

type SaveStatus = "idle" | "saving" | "saved" | "error";

function formatDate(ts: number, locale: string): string {
	const d = new Date(ts);
	return d.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

function getProjectTypeKey(project: { type: "normal" | "batch" } | undefined): "detail.typeBatch" | null {
	if (!project) return null;
	if (project.type === "batch") return "detail.typeBatch";
	return null;
}

function useProjectDetail(cwd: string) {
	const projects = useAtomValue(projectsAtom);
	const sessionsMap = useAtomValue(sessionsMapAtom);
	const batchProjects = useAtomValue(batchProjectsAtom);
	const sessions = sessionsMap.get(cwd) ?? [];

	const bp = batchProjects.find((b) => b.id === cwd);
	if (bp) {
		const project = projects.find((p) => p.cwd === cwd) ?? {
			cwd,
			name: bp.name,
			sessionCount: 0,
			type: "batch" as const,
		};
		const count = bp.tasks.filter((t) => t.sessionPath).length;
		return { project, sessions, sessionCount: count, batchProject: bp };
	}

	const project = projects.find((p) => p.cwd === cwd);
	return { project, sessions, sessionCount: sessions.length, batchProject: null };
}

export function useProjectInstruction(cwd: string, filename: "AGENTS.md" | "CLAUDE.md", enabled: boolean) {
	const [content, setContent] = useState("");
	const [original, setOriginal] = useState("");
	const [loading, setLoading] = useState(enabled);
	const [loadedPath, setLoadedPath] = useState<string | null>(null);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const loadRequest = useRef(0);
	const saveRequest = useRef(0);
	const filePath = `${cwd}/${filename}`;

	useEffect(() => {
		if (!enabled || loadedPath === filePath) return;
		const request = ++loadRequest.current;
		setSaveStatus("idle");
		saveRequest.current++;
		setLoading(true);
		void window.vetta.fs
			.readFile(filePath)
			.then(
				(result) => {
					if (request !== loadRequest.current) return;
					setContent(result.content);
					setOriginal(result.content);
				},
				() => {
					if (request !== loadRequest.current) return;
					setContent("");
					setOriginal("");
				},
			)
			.finally(() => {
				if (request !== loadRequest.current) return;
				setLoadedPath(filePath);
				setLoading(false);
			});
		return () => {
			loadRequest.current++;
		};
	}, [enabled, filePath, loadedPath]);

	const save = useCallback(async () => {
		const request = ++saveRequest.current;
		setSaveStatus("saving");
		try {
			await window.vetta.fs.writeFile(filePath, content);
			if (request !== saveRequest.current) return;
			setOriginal(content);
			setSaveStatus("saved");
		} catch {
			if (request === saveRequest.current) setSaveStatus("error");
		}
	}, [filePath, content]);

	return {
		content,
		setContent,
		loading: loading || loadedPath !== filePath,
		save,
		saveStatus,
		isDirty: content !== original,
	};
}

function useCreatedAt(cwd: string) {
	const [createdAt, setCreatedAt] = useState<number | null>(null);

	useEffect(() => {
		void window.vetta.fs.stat(cwd).then((result) => {
			if (result) setCreatedAt(result.createdAt);
		});
	}, [cwd]);

	return createdAt;
}

export interface ProjectDetailPageModel extends Omit<ProjectDetailPageViewProps, "activityPanel" | "batchSection"> {
	batchProject: ReturnType<typeof useProjectDetail>["batchProject"];
	decodedCwd: string;
	isBatch: boolean;
	isPersonal: boolean;
	projectType: "normal" | "batch" | undefined;
}

export function useProjectDetailPageModel(
	onOpenSession: (cwd: string, path?: string) => Promise<void>,
): ProjectDetailPageModel {
	const { t, i18n } = useTranslation("project");
	const dateLocale = i18n.language === "zh" ? "zh-CN" : "en-US";
	const { cwd } = useParams({ strict: false }) as { cwd: string };
	const decodedCwd = decodeURIComponent(cwd);

	const { project, sessions, sessionCount, batchProject } = useProjectDetail(decodedCwd);
	const createdAt = useCreatedAt(decodedCwd);
	const [activeDocument, setActiveDocument] = useState<"AGENTS.md" | "CLAUDE.md">("AGENTS.md");
	const [mode, setMode] = useState<"edit" | "preview">("preview");
	const theme = useAtomValue(resolvedThemeAtom);
	const pinnedSessions = useAtomValue(pinnedSessionPathsAtom);
	const agents = useProjectInstruction(decodedCwd, "AGENTS.md", true);
	const claude = useProjectInstruction(decodedCwd, "CLAUDE.md", activeDocument === "CLAUDE.md");
	const currentInstruction = activeDocument === "AGENTS.md" ? agents : claude;
	const { content, setContent, loading, save, saveStatus, isDirty } = currentInstruction;
	const runningPaths = useAtomValue(runningSessionPathsAtom);
	const runningTaskIds = useAtomValue(runningTaskIdsAtom);
	const scheduledTasks = useAtomValue(scheduledTasksAtom);
	useEffect(() => {
		if (!decodedCwd) return;
		setActiveDocument("AGENTS.md");
	}, [decodedCwd]);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const isPersonal = useAtomValue(isPersonalModeAtom);
	const [activityOpen, setActivityOpen] = useAtom(activityPanelOpenAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const [editorFocused, setEditorFocused] = useState(false);
	const navigate = useNavigate();

	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	const displayName = project?.name ?? pathBasename(decodedCwd);
	const isBatch = !!batchProject;
	const projectTypeKey = getProjectTypeKey(project);
	const projectTypeLabel = projectTypeKey ? t(projectTypeKey) : null;
	const exportable = project?.type === "normal" || project?.type === "batch" || isBatch;
	const recentSessions: ProjectDetailPageViewProps["recentSessions"] = useMemo(
		() =>
			sessions
				.filter((session) => resolveSessionOpenTarget([session], session.path) !== "unavailable")
				.slice()
				.sort((a, b) => {
					const pinA = pinnedSessions.get(a.path) ?? 0;
					const pinB = pinnedSessions.get(b.path) ?? 0;
					if (pinA !== pinB) return pinB - pinA;
					return b.modifiedAt - a.modifiedAt;
				})
				.slice(0, 5)
				.map((session) => ({
					path: session.path,
					label: sessionDisplayLabel(session),
					date: formatDate(session.modifiedAt, dateLocale),
					running: runningPaths.has(session.path),
					pinned: pinnedSessions.has(session.path),
				})),
		[sessions, dateLocale, runningPaths, pinnedSessions],
	);
	const runningSessionCount = sessions.reduce((count, session) => count + Number(runningPaths.has(session.path)), 0);
	const runningTaskCount = scheduledTasks.reduce(
		(count, task) => count + Number(task.runTarget.projectCwd === decodedCwd && runningTaskIds.has(task.id)),
		0,
	);

	const handleExportProject = useCallback(() => {
		setConfirm({
			title: t("exportDialog.title"),
			message: t("exportDialog.message", { name: displayName }),
			confirmLabel: t("exportDialog.confirm"),
			variant: "default",
			onConfirm: async () => {
				const result = await window.vetta.project.export(decodedCwd);
				if (result && "error" in result) {
					setConfirm({
						title: t("exportDialog.failedTitle"),
						message: result.error.message,
						confirmLabel: t("exportDialog.failedConfirm"),
						variant: "danger",
						onConfirm: () => {},
					});
				}
			},
		});
	}, [decodedCwd, displayName, setConfirm, t]);

	useShortcutScope({
		id: "surface:project-detail-editor",
		kind: "surface",
		active: true,
		exclusive: false,
		bindings: [
			{
				key: "mod+s",
				run: () => {
					if (isDirty) void save();
				},
			},
		],
	});

	return {
		activityOpen,
		activeDocument,
		mode,
		onModeChange: setMode,
		theme,
		recentSessions,
		runningSessionCount,
		runningTaskCount,
		batchProject,
		content,
		createdAtLabel: createdAt ? formatDate(createdAt, dateLocale) : null,
		cwd: decodedCwd,
		decodedCwd,
		displayName,
		editorFocused,
		exportable,
		isBatch,
		isDirty,
		isPersonal,
		labels: {
			showInFolderTitle: isMac ? t("detail.showInFinder") : t("detail.showInExplorer"),
			showInFolder: isMac ? t("detail.finder") : t("detail.explorer"),
			exportTitle: t("detail.exportTitle"),
			export: t("detail.export"),
			newSession: t("detail.newSession"),
			closeActivityPanel: t("detail.closeActivityPanel"),
			openActivityPanel: t("detail.openActivityPanel"),
			persona: t("detail.persona"),
			unsavedChanges: t("detail.unsavedChanges"),
			saved: t("detail.saved"),
			saveFailed: t("detail.saveFailed"),
			save: t("detail.save"),
			editorPlaceholder: t("detail.editorPlaceholderFile", { file: activeDocument }),
			agentsMdHint: t("detail.agentsMdHint"),
			quickSave: t("detail.quickSave"),
			saveShortcut: isMac ? "⌘+S" : "Ctrl+S",
			recentSessionsTitle: t("detail.recentSessions.title"),
			recentSessionsEmpty: t("detail.recentSessions.empty"),
			startFirst: t("detail.recentSessions.startFirst"),
			running: t("detail.runtime.runningSessions", { count: runningSessionCount }),
			runningTasks: t("detail.runtime.runningTasks", { count: runningTaskCount }),
			contextTitle: t("detail.context.title"),
			claudeHint: t("detail.claudeMdHint"),
			previewMode: t("detail.previewMode"),
			editMode: t("detail.editMode"),
			emptyFileTitle: t("detail.emptyFileTitle", { file: activeDocument }),
			emptyFileHint: t("detail.emptyFileHint"),
			startEditing: t("detail.startEditing"),
		},
		loading,
		projectType: project?.type,
		projectTypeLabel,
		saveStatus,
		sessionCountLabel: t("detail.sessionCount", { count: sessionCount }),
		taskCountLabel: isBatch ? t("detail.taskCount", { count: batchProject.tasks.length }) : null,
		textareaRef,
		onDocumentChange: setActiveDocument,
		onOpenRecentSession: (path: string) => {
			const session = sessions.find((item: SessionInfo) => item.path === path);
			if (!session) return;
			if (resolveSessionOpenTarget(sessions, path) === "viewer") {
				void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(path) } });
			} else {
				void onOpenSession(decodedCwd, path);
			}
		},
		onContentChange: setContent,
		onEditorBlur: () => setEditorFocused(false),
		onEditorFocus: () => setEditorFocused(true),
		onExport: handleExportProject,
		onNewSession: () => {
			void navigate({ to: "/new-session/$cwd", params: { cwd: encodeURIComponent(decodedCwd) } });
		},
		onSave: () => {
			void save();
		},
		onShowInFolder: () => {
			void window.vetta.shell.showInFolder(decodedCwd);
		},
		onToggleActivity: () => setActivityOpen((o) => !o),
	};
}
