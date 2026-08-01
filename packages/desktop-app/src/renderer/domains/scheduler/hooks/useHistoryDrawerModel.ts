import { useShortcutScope } from "@shared/shortcuts";
import type { ScheduledTask } from "@shared/store/atoms";
import { defaultConversationCwdAtom, getProjectDisplayName } from "@shared/store/atoms";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { describeSchedule, parseCronExpression } from "../components/schedule-picker/cron-utils";
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
			projectLabel: task?.cwd ? getProjectDisplayName(task.cwd, defaultCwd) : null,
			scheduleLabel: task ? scheduleLabel(task, t) : "",
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

function scheduleLabel(task: ScheduledTask, t: TFunction<"automation">): string {
	const parsed = parseCronExpression(task.cron, task.isOnce);
	if (parsed) return describeSchedule(parsed, t);
	return task.cron;
}
