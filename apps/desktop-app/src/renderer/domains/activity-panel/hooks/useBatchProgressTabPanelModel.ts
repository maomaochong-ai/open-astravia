import { type BatchProject, batchProjectsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface BatchProgressTabPanelModel {
	/** Batch project for cwd, or null when not found. */
	project: BatchProject | null;
	emptyLabel: string;
}

export function useBatchProgressTabPanelModel(cwd: string): BatchProgressTabPanelModel {
	const { t } = useTranslation("chat");
	const batchProjects = useAtomValue(batchProjectsAtom);
	const project = useMemo(() => batchProjects.find((item) => item.id === cwd) ?? null, [batchProjects, cwd]);

	return {
		project,
		emptyLabel: t("activityPanel.batchProgress.notFound"),
	};
}
