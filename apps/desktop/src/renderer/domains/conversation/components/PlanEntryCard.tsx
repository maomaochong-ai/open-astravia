import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useOpenActivityTab } from "../hooks/useOpenActivityTab";
import { outlinePlan } from "../services/plan-review";
import { PlanEntryCardView } from "./plan-entry-card/PlanEntryCardView";

/** 连接层：把已批准的计划接到 i18n 与「打开活动面板计划页」的动作上。 */
export function PlanEntryCard({ plan }: { plan: string }): JSX.Element {
	const { t } = useTranslation("chat");
	const openActivityTab = useOpenActivityTab(useAtomValue(activeSessionAtom)?.cwd);
	const outline = useMemo(() => outlinePlan(plan), [plan]);
	return (
		<PlanEntryCardView
			outline={outline}
			onOpen={() => openActivityTab("plan")}
			labels={{
				title: t("planMode.entryCard.title"),
				stepCount: outline.stepCount > 0 ? t("planMode.entryCard.stepCount", { count: outline.stepCount }) : "",
				moreSteps: t("planMode.entryCard.moreSteps", { count: outline.remainingSteps }),
				open: t("planMode.entryCard.open"),
				approved: t("planMode.toolCard.approved"),
			}}
		/>
	);
}
