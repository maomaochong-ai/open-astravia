import type { KnowledgeViewLabels } from "@vetta/theme-ui/knowledge";
import { useTranslation } from "react-i18next";

export type {
	KnowledgeProcessStatus,
	KnowledgeViewNode,
	KnowledgeViewProps,
} from "@vetta/theme-ui/knowledge";
export {
	formatFileSize,
	KnowledgeEmptyState,
	knowledgeDirItemCount,
	StatusBadge,
} from "@vetta/theme-ui/knowledge";

/** Host i18n labels for knowledge grid/list. */
export function useKnowledgeViewLabels(): KnowledgeViewLabels {
	const { t } = useTranslation("settings");
	return {
		badgeFailed: t("kbBadgeFailed"),
		badgeStale: t("kbBadgeStale"),
		badgeUnprocessed: t("kbBadgeUnprocessed"),
		emptySearchTitle: t("kbEmptySearchTitle"),
		emptySearchDesc: t("kbEmptySearchDesc"),
		emptyDirTitle: t("kbEmptyDirTitle"),
		emptyDirDesc: t("kbEmptyDirDesc"),
		itemCount: (n) => t("kbItemCount", { n }),
	};
}
