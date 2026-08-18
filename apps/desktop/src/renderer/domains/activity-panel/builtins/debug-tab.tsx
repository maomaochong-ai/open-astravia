import { debugModeAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { DebugTabPanel } from "../components/DebugTabPanel";
import { useActivityPanelCwd } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";

function DebugActivityTab(): JSX.Element | null {
	const cwd = useActivityPanelCwd();
	if (!cwd) return null;
	return <DebugTabPanel cwd={cwd} />;
}

export const debugTabDefinition: ActivityTabDefinition = {
	id: "debug",
	order: 90,
	removable: true,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		const debugMode = useAtomValue(debugModeAtom);
		if (!debugMode) return null;
		return {
			label: t("activityPanel.tabs.debug"),
			icon: "icon-[mdi--bug-outline]",
		};
	},
	component: DebugActivityTab,
};
