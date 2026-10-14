import { lazy } from "react";
import { useProjectProfile } from "@shared/lib/project-profile";
import { useTranslation } from "react-i18next";

import { useActivityPanelCwd } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";

const BatchProgressTabPanel = lazy(() =>
	import("../components/BatchProgressTabPanel").then((module) => ({ default: module.BatchProgressTabPanel })),
);

function BatchProgressActivityTab(): JSX.Element | null {
	const cwd = useActivityPanelCwd();
	if (!cwd) return null;
	return <BatchProgressTabPanel cwd={cwd} />;
}

export const batchProgressTabDefinition: ActivityTabDefinition = {
	id: "batch-progress",
	order: 10,
	removable: true,
	source: "builtin",
	useMeta: () => {
		const cwd = useActivityPanelCwd();
		const { profile } = useProjectProfile(cwd);
		const { t } = useTranslation("chat");
		if (profile?.type !== "batch") return null;
		return {
			label: t("activityPanel.tabs.batchProgress"),
			icon: "icon-[mdi--progress-clock]",
		};
	},
	component: BatchProgressActivityTab,
};
