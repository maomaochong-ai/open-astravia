import type { PlanStatusTone } from "@shared/components/PlanStatusBadge";
import { planModeStateBySessionAtom } from "@shared/store/atoms";
import type { CodingAgentPlan } from "@vetta/coding-agent/session-extensions";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { useActivityRuntimeIds } from "../registry/context";

export interface PlanTabPanelModel {
	readonly headline: string;
	readonly plan: { readonly content: string; readonly tone: PlanStatusTone; readonly statusLabel: string } | null;
}

const STATUS_TONE: Record<CodingAgentPlan["status"], PlanStatusTone> = {
	"pending-review": "pending",
	approved: "approved",
	"changes-requested": "changes-requested",
	dismissed: "dismissed",
};

/** 当前工作区里最近一份计划；一个工作区聚合多个 Runtime 时取第一个有计划的。 */
export function useActivityPlan(): CodingAgentPlan | undefined {
	const states = useAtomValue(planModeStateBySessionAtom);
	const runtimeIds = useActivityRuntimeIds();
	for (const runtimeId of runtimeIds) {
		const plan = states[runtimeId]?.plan;
		if (plan) return plan;
	}
	return undefined;
}

export function usePlanTabPanelModel(): PlanTabPanelModel {
	const { t } = useTranslation("chat");
	const plan = useActivityPlan();
	const statusLabels: Record<PlanStatusTone, string> = {
		pending: t("planMode.toolCard.pending"),
		approved: t("planMode.toolCard.approved"),
		"changes-requested": t("planMode.toolCard.changesRequested"),
		dismissed: t("planMode.toolCard.dismissed"),
	};
	const tone = plan ? STATUS_TONE[plan.status] : undefined;
	return {
		headline: t("activityPanel.plan.headline"),
		plan: plan && tone ? { content: plan.content, tone, statusLabel: statusLabels[tone] } : null,
	};
}
