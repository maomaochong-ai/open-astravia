import { useRefreshBatchProjects } from "@shared/hooks/useRefreshBatchProjects";
import type { SidebarFilter } from "@shared/store/atoms";
import { batchProjectDialogOpenAtom, confirmDialogAtom } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjects } from "../../../hooks/useProjects";
import type { AddProjectMenuItemModel } from "./types";

type FailureTitleKeys = "actionFailed.openTitle" | "actionFailed.newTitle" | "actionFailed.importTitle";
type FailureMessageKeys = "actionFailed.openMessage" | "actionFailed.newMessage" | "actionFailed.importMessage";
export function useAddProjectMenuModel({ filter }: { filter?: SidebarFilter }): {
	items: AddProjectMenuItemModel[];
	menuRef: React.RefObject<HTMLDivElement | null>;
	open: boolean;
	showNewProject: boolean;
	closeNewProjectDialog: () => void;
	confirmNewProject: (name: string) => void;
	toggleOpen: () => void;
} {
	const { t } = useTranslation("project");
	const { createProject, openProject, refreshProjects } = useProjects();
	const refreshBatchProjects = useRefreshBatchProjects();
	const setBatchProjectDialog = useSetAtom(batchProjectDialogOpenAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [showNewProject, setShowNewProject] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	const isBatchScope = filter === "batch";

	const showFailure = (titleKey: FailureTitleKeys, messageKey: FailureMessageKeys): void => {
		setConfirm({
			title: t(titleKey),
			message: t(messageKey),
			confirmLabel: t("actionFailed.confirm"),
			variant: "danger",
			onConfirm: () => {},
		});
	};

	const handleOpenProject = async (): Promise<void> => {
		setOpen(false);
		try {
			await openProject();
		} catch {
			showFailure("actionFailed.openTitle", "actionFailed.openMessage");
		}
	};

	const handleCreateProject = async (name: string): Promise<void> => {
		setShowNewProject(false);
		try {
			await createProject(name);
		} catch {
			showFailure("actionFailed.newTitle", "actionFailed.newMessage");
		}
	};

	/**
	 * Batch projects carry prompts and folders, so they are created in the batch
	 * dialog on the batch page rather than by the plain new-project dialog.
	 */
	const handleNewProject = (): void => {
		setOpen(false);
		if (!isBatchScope) {
			setShowNewProject(true);
			return;
		}
		setBatchProjectDialog(null);
		void navigate({ to: "/batch-tasks" });
	};

	const handleImport = async (): Promise<void> => {
		setOpen(false);
		let result: Awaited<ReturnType<typeof window.astravia.project.import>>;
		try {
			result = await window.astravia.project.import();
		} catch {
			showFailure("actionFailed.importTitle", "actionFailed.importMessage");
			return;
		}
		if (!result) return;
		if ("error" in result) {
			setConfirm({
				title: t("importDialog.failedTitle"),
				message: result.error.message,
				confirmLabel: t("importDialog.failedConfirm"),
				variant: "danger",
				onConfirm: () => {},
			});
			return;
		}
		await Promise.all([refreshProjects(), refreshBatchProjects()]).catch(() => {});
		const missing = result.missingSources;
		const onJump = (): void => {
			void navigate({
				to: "/project/$cwd",
				params: { cwd: encodeURIComponent(result.path) },
			});
		};
		if (missing && missing.length > 0) {
			const more = missing.length > 8 ? t("importDialog.partialMore", { count: missing.length - 8 }) : "";
			const list = missing.slice(0, 8).join("\n") + more;
			setConfirm({
				title: t("importDialog.partialTitle"),
				message: t("importDialog.partialMessage", {
					name: result.name,
					count: missing.length,
					list,
				}),
				confirmLabel: t("importDialog.viewProject"),
				cancelLabel: t("importDialog.gotIt"),
				variant: "default",
				onConfirm: onJump,
			});
			return;
		}
		setConfirm({
			title: t("importDialog.doneTitle"),
			message: t("importDialog.doneMessage", { name: result.name }),
			confirmLabel: t("importDialog.viewProject"),
			cancelLabel: t("importDialog.gotIt"),
			variant: "default",
			onConfirm: onJump,
		});
	};

	useEffect(() => {
		if (!open) return;
		function handleClick(e: MouseEvent): void {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [open]);

	return {
		items: [
			{
				action: "newProject",
				icon: "icon-[solar--add-folder-linear]",
				labelKey: "actions.newProject",
				onSelect: handleNewProject,
			},
			{
				action: "openProject",
				icon: "icon-[solar--folder-open-linear]",
				labelKey: "actions.openProject",
				onSelect: () => {
					void handleOpenProject();
				},
			},
			{
				action: "importProject",
				icon: "icon-[solar--import-linear]",
				labelKey: "actions.importProject",
				onSelect: () => {
					void handleImport();
				},
			},
		],
		menuRef,
		open,
		showNewProject,
		closeNewProjectDialog: () => setShowNewProject(false),
		confirmNewProject: (name: string) => {
			void handleCreateProject(name);
		},
		toggleOpen: () => setOpen((value) => !value),
	};
}
