import { workflowProgressLabel, workflowStatusMeta } from "@shared/lib/workflow-status";
import {
	activeSessionAtom,
	type ChatMessage,
	getSubagentsForSession,
	isSubagentActive,
	isWorkflowTask,
	type SubagentTask,
	selectedWorkflowIdAtom,
	subagentsBySessionAtom,
	workflowDisplayName,
} from "@shared/store/atoms";
import type { WorkflowSwitcherItem } from "@vetta/theme-ui/activity";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fullHistoryToChat } from "../../chat/services/chat-service";

export interface WorkflowTabPanelModel {
	items: WorkflowSwitcherItem[];
	selected: SubagentTask | null;
	messages: ChatMessage[];
	emptyLabel: string;
	stopLabel: string;
	noTranscriptLabel: string;
	onSelect: (id: string) => void;
	onStop: (id: string) => void;
}

export function useWorkflowTabPanelModel(): WorkflowTabPanelModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const subagentsMap = useAtomValue(subagentsBySessionAtom);
	const [selectedId, setSelectedId] = useAtom(selectedWorkflowIdAtom);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const runtimeId = activeSession?.runtimeId ?? null;

	const workflows = useMemo(
		() => getSubagentsForSession(subagentsMap, runtimeId).filter(isWorkflowTask),
		[subagentsMap, runtimeId],
	);

	const selected = useMemo(() => {
		if (selectedId) {
			const match = workflows.find((w) => w.id === selectedId);
			if (match) return match;
		}
		return workflows.find((w) => isSubagentActive(w.status)) ?? workflows[0] ?? null;
	}, [workflows, selectedId]);

	const items = useMemo(
		() =>
			workflows.map((task) => {
				const meta = workflowStatusMeta(task.status, t);
				return {
					id: task.id,
					name: workflowDisplayName(task),
					progressLabel: workflowProgressLabel(task),
					statusIcon: meta.icon,
					statusClassName: meta.className,
					selected: task.id === selected?.id,
					active: isSubagentActive(task.status),
				};
			}),
		[workflows, selected?.id, t],
	);

	// Read-only live transcript: reuse the no-lock session viewer channel on the
	// child's own jsonl (fs-watch pushes fresh snapshots while the child runs).
	const sessionFile = selected?.sessionFile;
	useEffect(() => {
		setMessages([]);
		if (!sessionFile) return;
		let cancelled = false;
		let unsubscribe: (() => void) | undefined;

		(async () => {
			try {
				const initial = await window.vetta.session.openViewer(sessionFile);
				if (cancelled) return;
				setMessages(fullHistoryToChat(initial.history));
				unsubscribe = await window.vetta.session.subscribeViewer(sessionFile, (snapshot) => {
					setMessages(fullHistoryToChat(snapshot.history));
				});
				if (cancelled) unsubscribe?.();
			} catch {
				// Child file may not exist yet (queued / just spawning); keep empty state.
			}
		})();

		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [sessionFile]);

	const onSelect = useCallback((id: string) => setSelectedId(id), [setSelectedId]);
	const onStop = useCallback(
		(id: string) => {
			if (!runtimeId) return;
			void window.vetta.session.interruptSubagent?.(runtimeId, id);
		},
		[runtimeId],
	);

	return {
		items,
		selected,
		messages,
		emptyLabel: t("activityPanel.workflow.empty"),
		stopLabel: t("activityPanel.workflow.stop"),
		noTranscriptLabel: t("activityPanel.workflow.noTranscript"),
		onSelect,
		onStop,
	};
}
