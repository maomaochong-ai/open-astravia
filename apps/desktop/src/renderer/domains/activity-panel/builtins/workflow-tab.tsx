import {
	activeSessionAtom,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	subagentsBySessionAtom,
} from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { WorkflowTabPanel } from "../components/WorkflowTabPanel";
import type { ActivityTabDefinition } from "../registry/types";

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
		const activeSession = useAtomValue(activeSessionAtom);
		const subagentsMap = useAtomValue(subagentsBySessionAtom);
		const workflows = useMemo(() => {
			const all = getSubagentsForSession(subagentsMap, activeSession?.runtimeId ?? null);
			return all.filter(isWorkflowTask);
		}, [subagentsMap, activeSession?.runtimeId]);
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
