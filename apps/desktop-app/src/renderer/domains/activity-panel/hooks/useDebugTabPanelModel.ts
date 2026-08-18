import { debugSubTabAtom } from "@shared/store/atoms";
import type { DebugSubTab } from "@vetta/theme-ui/activity";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

export interface DebugTabPanelModel {
	subTab: DebugSubTab;
	setSubTab: (tab: DebugSubTab) => void;
	toolCallsLabel: string;
	requestHistoryLabel: string;
}

export function useDebugTabPanelModel(): DebugTabPanelModel {
	const { t } = useTranslation("chat");
	const [subTab, setSubTab] = useAtom(debugSubTabAtom);

	return {
		subTab,
		setSubTab,
		toolCallsLabel: t("activityPanel.debug.toolCalls"),
		requestHistoryLabel: t("activityPanel.debug.requestHistory"),
	};
}
