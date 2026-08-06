import { useBatchTasks } from "@domains/batch-tasks/hooks/useBatchTasks";
import { confirmDialogAtom } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjectActions } from "../../../hooks/useProjects";
import type { AddProjectMenuItemModel } from "./types";

export function useAddProjectMenuModel(): {
	items: AddProjectMenuItemModel[];
	menuRef: React.RefObject<HTMLDivElement | null>;
	open: boolean;
	showNewProject: boolean;
	closeNewProjectDialog: () => void;
	confirmNewProject: (name: string) => void;
	toggleOpen: () => void;
} {
	const { t } = useTranslation("project");
	const { createProject, openProject, refreshProjects } = useProjectActions();
	const { refreshProjects: refreshBatchProjects } = useBatchTasks();
	const setConfirm = useSetAtom(confirmDialogAtom);
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [showNewProject, setShowNewProject] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const handleImport = async (): Promise<void> => {
		setOpen(false);
		const result = await window.vetta.project.import();
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
				onSelect: () => {
					setOpen(false);
					setShowNewProject(true);
				},
			},
			{
				action: "openProject",
				icon: "icon-[solar--folder-open-linear]",
				labelKey: "actions.openProject",
				onSelect: () => {
					setOpen(false);
					void openProject();
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
			setShowNewProject(false);
			void createProject(name);
		},
		toggleOpen: () => setOpen((value) => !value),
	};
}
