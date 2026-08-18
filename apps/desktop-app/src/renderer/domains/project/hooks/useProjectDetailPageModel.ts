import { isMac } from "@shared/lib/platform";
import { pathBasename } from "@shared/lib/utils";
import { useShortcutScope } from "@shared/shortcuts";
import {
	activityPanelOpenAtom,
	batchProjectsAtom,
	confirmDialogAtom,
	isPersonalModeAtom,
	pageHeaderTitleHiddenAtom,
	projectsAtom,
	sessionsMapAtom,
} from "@shared/store/atoms";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { ProjectDetailPageViewProps } from "@vetta/theme-ui/project";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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

	const bp = batchProjects.find((b) => b.id === cwd);
	if (bp) {
		const project = projects.find((p) => p.cwd === cwd) ?? {
			cwd,
			name: bp.name,
			sessionCount: 0,
			type: "batch" as const,
		};
		const count = bp.tasks.filter((t) => t.sessionPath).length;
		return { project, sessionCount: count, batchProject: bp };
	}

	const project = projects.find((p) => p.cwd === cwd);
	const sessions = sessionsMap.get(cwd) ?? [];
	return { project, sessionCount: sessions.length, batchProject: null };
}

function useAgentsMd(cwd: string) {
	const [content, setContent] = useState("");
	const [original, setOriginal] = useState("");
	const [loading, setLoading] = useState(true);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

	const filePath = `${cwd}/AGENTS.md`;

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const result = await window.vetta.fs.readFile(filePath);
			setContent(result.content);
			setOriginal(result.content);
		} catch {
			setContent("");
			setOriginal("");
		}
		setLoading(false);
	}, [filePath]);

	useEffect(() => {
		void load();
	}, [load]);

	const save = useCallback(async () => {
		setSaveStatus("saving");
		try {
			await window.vetta.fs.writeFile(filePath, content);
			setOriginal(content);
			setSaveStatus("saved");
			setTimeout(() => setSaveStatus("idle"), 2000);
		} catch {
			setSaveStatus("error");
			setTimeout(() => setSaveStatus("idle"), 3000);
		}
	}, [filePath, content]);

	const isDirty = content !== original;

	return { content, setContent, loading, save, saveStatus, isDirty };
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

export function useProjectDetailPageModel(): ProjectDetailPageModel {
	const { t, i18n } = useTranslation("project");
	const dateLocale = i18n.language === "zh" ? "zh-CN" : "en-US";
	const { cwd } = useParams({ strict: false }) as { cwd: string };
	const decodedCwd = decodeURIComponent(cwd);

	const { project, sessionCount, batchProject } = useProjectDetail(decodedCwd);
	const createdAt = useCreatedAt(decodedCwd);
	const { content, setContent, loading, save, saveStatus, isDirty } = useAgentsMd(decodedCwd);
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
			editorPlaceholder: t("detail.editorPlaceholder"),
			agentsMdHint: t("detail.agentsMdHint"),
			quickSave: t("detail.quickSave"),
			saveShortcut: isMac ? "⌘+S" : "Ctrl+S",
		},
		loading,
		projectType: project?.type,
		projectTypeLabel,
		saveStatus,
		sessionCountLabel: t("detail.sessionCount", { count: sessionCount }),
		taskCountLabel: isBatch ? t("detail.taskCount", { count: batchProject.tasks.length }) : null,
		textareaRef,
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
