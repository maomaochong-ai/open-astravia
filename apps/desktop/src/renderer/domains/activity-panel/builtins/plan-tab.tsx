import { useTranslation } from "react-i18next";
import { PlanTabPanel } from "../components/PlanTabPanel";
import { useActivityPlan } from "../hooks/usePlanTabPanelModel";
import type { ActivityTabDefinition } from "../registry/types";

export const planTabDefinition: ActivityTabDefinition = {
	id: "plan",
	// 紧邻待办之前：计划是待办的来源，先看计划再看进度。
	order: 18,
	removable: true,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		const plan = useActivityPlan();
		if (!plan) return null;
		return { label: t("activityPanel.tabs.plan"), icon: "icon-[solar--checklist-minimalistic-linear]" };
	},
	component: PlanTabPanel,
};
