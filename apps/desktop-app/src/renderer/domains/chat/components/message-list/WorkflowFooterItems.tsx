import type { ActivityTabKey } from "@shared/lib/project-profile";
import { workflowProgressLabel, workflowStatusMeta } from "@shared/lib/workflow-status";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	selectedWorkflowIdAtom,
	subagentsBySessionAtom,
	workflowDisplayName,
} from "@shared/store/atoms";
import { WorkflowFooterItemsView } from "@vetta/theme-ui/chat";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * Workflow summary items under the message list (ADR-0044).
 * Click opens the workflow activity tab focused on that workflow.
 */
export function WorkflowFooterItems(): JSX.Element | null {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const subagentsMap = useAtomValue(subagentsBySessionAtom);
	const setPanelOpen = useSetAtom(activityPanelOpenAtom);
	const setTabByProject = useSetAtom(activityPanelTabByProjectAtom);
	const setSelectedWorkflow = useSetAtom(selectedWorkflowIdAtom);
	const runtimeId = activeSession?.runtimeId ?? null;

	const workflows = useMemo(
		() => getSubagentsForSession(subagentsMap, runtimeId).filter(isWorkflowTask),
		[subagentsMap, runtimeId],
	);

	const items = useMemo(
		() =>
			workflows.map((task) => {
				const meta = workflowStatusMeta(task.status, t);
				return {
					id: task.id,
					name: workflowDisplayName(task),
					progressLabel: workflowProgressLabel(task),
					statusLabel: meta.label,
					statusClassName: meta.className,
					active: isSubagentActive(task.status),
					completed: task.status === "completed",
				};
			}),
		[workflows, t],
	);

	const handleOpen = useCallback(
		(id: string) => {
			setSelectedWorkflow(id);
			const cwd = activeSession?.cwd;
			if (cwd) {
				setTabByProject((prev) => {
					const map = new Map(prev);
					map.set(cwd, "workflow" as ActivityTabKey);
					return map;
				});
			}
			setPanelOpen(true);
		},
		[activeSession?.cwd, setPanelOpen, setTabByProject, setSelectedWorkflow],
	);

	const handleStop = useCallback(
		(id: string) => {
			if (!runtimeId) return;
			void window.vetta.session.interruptSubagent?.(runtimeId, id);
		},
		[runtimeId],
	);

	if (items.length === 0) return null;
	const activeCount = items.filter((item) => item.active).length;
	return (
		<WorkflowFooterItemsView
			items={items}
			title={
				activeCount > 0
					? t("activityPanel.workflow.processingTitle", { count: activeCount })
					: t("activityPanel.workflow.doneTitle")
			}
			processing={activeCount > 0}
			stopLabel={t("activityPanel.workflow.stop")}
			onOpen={handleOpen}
			onStop={handleStop}
		/>
	);
}
