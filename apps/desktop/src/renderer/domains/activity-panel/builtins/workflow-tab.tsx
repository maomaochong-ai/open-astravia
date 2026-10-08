import { getSubagentsForSession, isSubagentActive, isWorkflowTask, subagentsBySessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useActivityRuntimeIds } from "../registry/context";
import type { ActivityTabDefinition } from "../registry/types";
import { collectRuntimeItems } from "../services/runtime-scope";

const WorkflowTabPanel = lazy(() =>
	import("../components/WorkflowTabPanel").then((module) => ({ default: module.WorkflowTabPanel })),
);

function WorkflowActivityTab(): JSX.Element {
	return <WorkflowTabPanel />;
}

export const workflowTabDefinition: ActivityTabDefinition = {
	id: "workflow",
	order: 40,
	removable: true,
	source: "builtin",
	useMeta: () => {
		const { t } = useTranslation("chat");
		const runtimeIds = useActivityRuntimeIds();
		const subagentsMap = useAtomValue(subagentsBySessionAtom);
		const workflows = useMemo(
			() =>
				collectRuntimeItems(runtimeIds, (runtimeId) =>
					getSubagentsForSession(subagentsMap, runtimeId).filter(isWorkflowTask),
				),
			[subagentsMap, runtimeIds],
		);
		if (workflows.length === 0) return null;
		const runningWorkflows = workflows.filter((a) => isSubagentActive(a.status)).length;
		return {
			label: t("activityPanel.tabs.workflow"),
			icon: "icon-[mdi--sitemap-outline]",
			badge: runningWorkflows || undefined,
		};
	},
	component: WorkflowActivityTab,
};
