import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import {
	activeKnowledgeBaseIdAtom,
	activityPanelOpenAtom,
	confirmDialogAtom,
	knowledgeBasesAtom,
	knowledgeFileStatusesAtom,
	knowledgeImportDraftAtom,
	knowledgeLoadingAtom,
	knowledgeNavTargetAtom,
	knowledgeViewModeAtom,
	refreshKnowledgeBasesAtom,
	type SessionInfo,
} from "@shared/store/atoms";
import { knowledgeBaseEnabledAtom } from "@shared/store/plugin-atoms";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KnowledgeImportConfirmation } from "../components/KnowledgeImportDialog";
import {
	collectUnprocessedFromStatuses,
	knowledgeBaseDisplayName,
	shouldShowKnowledgeFilesSkeleton,
} from "../lib/knowledge-base";
import { useKnowledgeImportSources } from "./useKnowledgeImportSources";

export function useKnowledgeBasePageModel() {
	const { t } = useTranslation(["settings", "common"]);
	const [knowledgeBases] = useAtom(knowledgeBasesAtom);
	const loading = useAtomValue(knowledgeLoadingAtom);
	const [activeId, setActiveId] = useAtom(activeKnowledgeBaseIdAtom);
	const [draft, setDraft] = useAtom(knowledgeImportDraftAtom);
	const refresh = useSetAtom(refreshKnowledgeBasesAtom);
	const confirm = useSetAtom(confirmDialogAtom);
	const setActivityPanelOpen = useSetAtom(activityPanelOpenAtom);
	const knowledgeBaseEnabled = useAtomValue(knowledgeBaseEnabledAtom);
	const setKnowledgeBaseEnabled = useSetAtom(knowledgeBaseEnabledAtom);
	const [viewMode, setViewMode] = useAtom(knowledgeViewModeAtom);
	const narrow = useNarrowScreen();
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const [howItWorksOpen, setHowItWorksOpen] = useState(false);
	const [pendingOpen, setPendingOpen] = useState(false);
	const fileStatuses = useAtomValue(knowledgeFileStatusesAtom);
	const setNavTarget = useSetAtom(knowledgeNavTargetAtom);
	const { fileInputRef, openFilePicker, openFolderPicker, onFilesPicked } = useKnowledgeImportSources();

	const activeBase = knowledgeBases.find((base) => base.id === activeId) ?? knowledgeBases[0] ?? null;

	// 待加工列表来自加工态 map，不依赖懒加载文件树（深层未打开的叶子也能出现）。
	const pendingFiles = useMemo(
		() => (activeBase ? collectUnprocessedFromStatuses(activeBase.id, fileStatuses) : []),
		[activeBase, fileStatuses],
	);
	const pendingCount = pendingFiles.length;

	// 仅「列表尚无缓存」时页面级骨架；有 activeBase 时绝不能因骨架卸载内容面板（会丢浏览 path）。
	const showFilesSkeleton = shouldShowKnowledgeFilesSkeleton({
		listLoading: loading,
		basesEmpty: knowledgeBases.length === 0,
	});

	const enableKnowledgeBase = useCallback(() => {
		void (async () => {
			await window.vetta.config.set({ knowledgeBase: { enabled: true } });
			await window.vetta.knowledge.reload();
			setKnowledgeBaseEnabled(true);
		})();
	}, [setKnowledgeBaseEnabled]);

	const openProcessingRecords = useCallback(() => {
		void (async () => {
			const config = await window.vetta.config.get();
			const cwd = config.knowledgeProcessingCwd;
			const list = cwd ? ((await window.vetta.session.listSessions(cwd)) as SessionInfo[]) : [];
			if (list.length === 0) {
				confirm({
					title: t("settings:kbPageRecordsEmptyTitle"),
					message: t("settings:kbPageRecordsEmptyMsg"),
					confirmLabel: t("settings:kbPageGotIt"),
					onConfirm: () => {},
				});
				return;
			}
			setActivityPanelOpen(true);
			void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(list[0].path) } });
		})();
	}, [confirm, navigate, setActivityPanelOpen, t]);

	const openKnowledgeSettings = useCallback(() => {
		void navigate({ to: "/settings/$tab", params: { tab: "knowledge" } });
	}, [navigate]);

	const openAllKnowledgeBases = useCallback(() => {
		void navigate({ to: "/knowledge/all" });
	}, [navigate]);

	const openKnowledgeHome = useCallback(() => {
		void navigate({ to: "/knowledge" });
	}, [navigate]);

	const openCreateDialog = useCallback(() => {
		setDraft({ sourcePaths: [], defaultTargetId: null, createOnly: true });
	}, [setDraft]);

	const showError = useCallback(
		(err: unknown) => {
			confirm({
				title: t("settings:kbPageOpFailed"),
				message: err instanceof Error ? err.message : String(err),
				confirmLabel: t("settings:kbPageGotIt"),
				onConfirm: () => {},
			});
		},
		[confirm, t],
	);

	const confirmImport = useCallback(
		async ({ targetId, name, sourcePaths }: KnowledgeImportConfirmation) => {
			setDraft(null);
			try {
				let kbId = targetId;
				if (!kbId) {
					await window.vetta.knowledge.create(name);
					kbId = name;
				}
				if (sourcePaths.length > 0) {
					await window.vetta.knowledge.addFiles(kbId, sourcePaths, false);
				}
				await refresh();
				setActiveId(kbId);
			} catch (err) {
				showError(err);
			}
		},
		[refresh, setActiveId, setDraft, showError],
	);

	const renameBase = useCallback(
		async (newName: string) => {
			if (!activeBase) return;
			try {
				await window.vetta.knowledge.rename(activeBase.id, newName);
				await refresh();
				setActiveId(newName);
			} catch (err) {
				showError(err);
			}
		},
		[activeBase, refresh, setActiveId, showError],
	);

	const deleteBase = useCallback(async () => {
		if (!activeBase) return;
		const remaining = knowledgeBases.filter((base) => base.id !== activeBase.id);
		try {
			await window.vetta.knowledge.delete(activeBase.id);
			setActiveId(remaining[0]?.id ?? null);
			await refresh();
		} catch (err) {
			showError(err);
		}
	}, [activeBase, knowledgeBases, refresh, setActiveId, showError]);

	const requestDeleteBase = useCallback(() => {
		if (!activeBase) return;
		confirm({
			title: t("settings:kbDeleteBaseTitle"),
			message: t("settings:kbDeleteBaseMsg", { name: knowledgeBaseDisplayName(activeBase) }),
			variant: "danger",
			confirmLabel: t("common:actions.delete"),
			onConfirm: deleteBase,
		});
	}, [activeBase, confirm, deleteBase, t]);

	const pickFilesForActiveBase = useCallback(
		() => openFilePicker(activeBase?.id ?? null),
		[activeBase?.id, openFilePicker],
	);

	const pickFoldersForActiveBase = useCallback(
		() => void openFolderPicker(activeBase?.id ?? null),
		[activeBase?.id, openFolderPicker],
	);

	const handlePickPending = useCallback(
		(fileId: string) => {
			setPendingOpen(false);
			setNavTarget({ fileId });
		},
		[setNavTarget],
	);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return {
		activeBase,
		confirmImport,
		draft,
		enableKnowledgeBase,
		fileInputRef,
		handlePickPending,
		howItWorksOpen,
		knowledgeBaseEnabled,
		knowledgeBases,
		loading,
		narrow,
		showFilesSkeleton,
		onFilesPicked,
		openAllKnowledgeBases,
		openCreateDialog,
		openKnowledgeHome,
		openKnowledgeSettings,
		openProcessingRecords,
		pendingCount,
		pendingFiles,
		pendingOpen,
		pickFilesForActiveBase,
		pickFoldersForActiveBase,
		refresh,
		renameBase,
		requestDeleteBase,
		search,
		setActiveId,
		setDraft,
		setHowItWorksOpen,
		setPendingOpen,
		setSearch,
		setViewMode,
		viewMode,
	};
}
