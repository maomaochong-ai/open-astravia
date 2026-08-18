import type { SessionInfo } from "@shared/store/atoms";
import type { ProjectSessionsViewLabels } from "@vetta/theme-ui/project";
import { useTranslation } from "react-i18next";

interface Args {
	hasMore: boolean;
	hiddenCount: number;
	showAll: boolean;
}

export function useProjectSessionsModel({ hasMore, hiddenCount, showAll }: Args): {
	hasMore: boolean;
	labels: ProjectSessionsViewLabels;
	showAll: boolean;
} {
	const { t } = useTranslation("project");
	return {
		hasMore,
		showAll,
		labels: {
			collapse: t("sidebar.projects.collapseSessions"),
			expand: t("sidebar.projects.expandMore", { count: hiddenCount }),
		},
	};
}

export type { SessionInfo };
