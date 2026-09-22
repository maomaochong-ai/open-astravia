import { useShortcutScope } from "@shared/shortcuts";
import type { ScheduledTask } from "@shared/store/atoms";
import { defaultConversationCwdAtom, getProjectDisplayName } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { describeSchedule } from "../components/schedule-picker/describe-schedule";
import { useScheduledTasks } from "./useScheduledTasks";

export interface HistoryDrawerModel {
	readonly projectLabel: string | null;
	readonly scheduleLabel: string;
	readonly task: ScheduledTask | null;
	readonly onRunNow: () => void;
	readonly onToggleTask: () => void;
}

interface UseHistoryDrawerModelOptions {
	readonly task: ScheduledTask | null;
	readonly onClose: () => void;
}

export function useHistoryDrawerModel({ task, onClose }: UseHistoryDrawerModelOptions): HistoryDrawerModel {
	const { t } = useTranslation("automation");
	const defaultCwd = useAtomValue(defaultConversationCwdAtom);
	const { runNow, toggleTask } = useScheduledTasks();

	useShortcutScope({
		id: "overlay:scheduler-history-drawer",
		kind: "overlay",
		active: task != null,
		exclusive: false,
		bindings: [{ key: "escape", run: () => onClose() }],
	});

	return useMemo(
		() => ({
			projectLabel: task ? getProjectDisplayName(task.runTarget.projectCwd, defaultCwd) : null,
			scheduleLabel: task ? describeSchedule(task.schedule, t) : "",
			task,
			onRunNow: (): void => {
				if (task) void runNow(task.id);
			},
			onToggleTask: (): void => {
				if (task) void toggleTask(task.id);
			},
		}),
		[defaultCwd, runNow, t, task, toggleTask],
	);
}
