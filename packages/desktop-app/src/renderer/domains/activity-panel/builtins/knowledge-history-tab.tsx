import { useTranslation } from "react-i18next";
import { KnowledgeHistoryPanel } from "../components/KnowledgeHistoryPanel";
import { useActivityPanelContext, useActivityPanelCwd } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";

function KnowledgeHistoryActivityTab(): JSX.Element {
	const cwd = useActivityPanelCwd();
	return <KnowledgeHistoryPanel cwd={cwd} />;
}

export const knowledgeHistoryTabDefinition: ActivityTabDefinition = {
	id: "knowledge-history",
	order: 0,
	removable: false,
	source: "builtin",
	useMeta: () => {
		const { knowledgeHistory } = useActivityPanelContext();
		const { t } = useTranslation("chat");
		// 仅知识库会话面板实例展示；普通会话不出现此 tab。
		if (!knowledgeHistory) return null;
		return {
			label: t("activityPanel.tabs.knowledgeHistory"),
			icon: "icon-[mdi--history]",
		};
	},
	component: KnowledgeHistoryActivityTab,
};
