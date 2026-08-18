import { useProjectActions } from "@domains/project/hooks/useProjects";
import type { ProjectEntry } from "@preload/api";
import { pathBasename } from "@shared/lib/utils";
import { confirmDialogAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface ArchivedProjectItem {
	name: string;
	path: string;
}

export interface ArchivedProjectsSettingsModel {
	actions: {
		delete: (path: string) => void;
		unarchive: (path: string) => Promise<void>;
	};
	labels: {
		deleteProject: string;
		empty: string;
		sectionTitle: string;
		title: string;
		unarchive: string;
	};
	projects: readonly ArchivedProjectItem[];
}

function projectName(entry: ProjectEntry): string {
	return entry.name ?? pathBasename(entry.path);
}

export function useArchivedProjectsSettingsModel(): ArchivedProjectsSettingsModel {
	const { t } = useTranslation("settings");
	const [archivedList, setArchivedList] = useState<ProjectEntry[]>([]);
	const { unarchiveProject, deleteArchivedProject } = useProjectActions();
	const setConfirm = useSetAtom(confirmDialogAtom);

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			setArchivedList(config.archivedProjects ?? []);
		});
	}, []);

	const unarchive = useCallback(
		async (path: string) => {
			await unarchiveProject(path);
			setArchivedList((prev) => prev.filter((entry) => entry.path !== path));
			recordSettingsUsage({ tab: "archived", action: "restored", target: "project" });
		},
		[unarchiveProject],
	);

	const deleteProject = useCallback(
		(path: string) => {
			const entry = archivedList.find((item) => item.path === path);
			if (!entry) return;
			setConfirm({
				title: t("deleteArchiveConfirm"),
				message: t("deleteArchiveMessage", { name: projectName(entry) }),
				confirmLabel: t("archiveDelete"),
				variant: "danger",
				onConfirm: () => {
					void deleteArchivedProject(path).then(() => {
						setArchivedList((prev) => prev.filter((item) => item.path !== path));
						recordSettingsUsage({ tab: "archived", action: "deleted", target: "project" });
					});
				},
			});
		},
		[archivedList, deleteArchivedProject, setConfirm, t],
	);

	const projects = useMemo<readonly ArchivedProjectItem[]>(
		() => archivedList.map((entry) => ({ name: projectName(entry), path: entry.path })),
		[archivedList],
	);

	const labels = useMemo(
		() => ({
			deleteProject: t("deleteProject"),
			empty: t("noArchivedProjects"),
			sectionTitle: t(SETTINGS_SECTION["archived-list"].titleKey),
			title: t("archivedProjects"),
			unarchive: t("unarchive"),
		}),
		[t],
	);

	return {
		actions: {
			delete: deleteProject,
			unarchive,
		},
		labels,
		projects,
	};
}
