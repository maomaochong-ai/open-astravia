import type { SessionExecutionMode } from "@shared/store/atoms";
import { defaultConversationCwdAtom, getProjectDisplayName, projectsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SchedulerTaskDraft } from "../components/SchedulerTaskFields";
import {
	describeSchedule,
	getDefaultDailySchedule,
	parseCronExpression,
	type Schedule,
	toCronExpression,
} from "../components/schedule-picker/cron-utils";

export interface WorkDirOption {
	readonly cwd: string;
	readonly name: string;
}

export interface ScheduleModeOption {
	readonly key: CompactScheduleMode;
	readonly label: string;
}

export type CompactScheduleMode = "once" | "daily" | "interval";

export interface SchedulerTaskFieldsModel {
	readonly defaultExecutionMode: SessionExecutionMode;
	readonly executionIcon: string;
	readonly executionLabel: string;
	readonly executionMode: SchedulerTaskDraft["executionMode"] | "inherit";
	readonly mode: CompactScheduleMode;
	readonly namePlaceholderText: string;
	readonly sandboxUnavailableReason: string | null;
	readonly schedule: Schedule;
	readonly scheduleLabel: string;
	readonly scheduleModes: readonly ScheduleModeOption[];
	readonly workDirOptions: readonly WorkDirOption[];
	readonly onFieldChange: <Key extends keyof SchedulerTaskDraft>(key: Key, nextValue: SchedulerTaskDraft[Key]) => void;
	readonly onScheduleChange: (nextSchedule: Schedule) => void;
}

interface UseSchedulerTaskFieldsModelOptions {
	readonly namePlaceholder: string | undefined;
	readonly onChange: (value: SchedulerTaskDraft) => void;
	readonly value: SchedulerTaskDraft;
}

export function useSchedulerTaskFieldsModel({
	namePlaceholder,
	onChange,
	value,
}: UseSchedulerTaskFieldsModelOptions): SchedulerTaskFieldsModel {
	const { t } = useTranslation("automation");
	const projects = useAtomValue(projectsAtom);
	const defaultCwd = useAtomValue(defaultConversationCwdAtom);
	const projectName = useCallback((cwd: string) => getProjectDisplayName(cwd, defaultCwd), [defaultCwd]);
	const [schedule, setSchedule] = useState<Schedule>(
		() => parseCronExpression(value.cron ?? "", value.isOnce ?? false) ?? getDefaultDailySchedule(),
	);
	const [defaultExecutionMode, setDefaultExecutionMode] = useState<SessionExecutionMode>("full-access");
	const [sandboxUnavailableReason, setSandboxUnavailableReason] = useState<string | null>(null);

	useEffect(() => {
		const parsed = parseCronExpression(value.cron ?? "", value.isOnce ?? false);
		if (parsed && parsed.mode !== "weekly") setSchedule(parsed);
	}, [value.cron, value.isOnce]);

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			setDefaultExecutionMode(config.defaultExecutionMode ?? "full-access");
			const capability = config.sandbox ?? config.linuxSandbox;
			if (capability?.status === "unavailable") {
				const reason = capability.reason ?? "unknown_error";
				const platform = "platform" in capability ? capability.platform : "linux";
				setSandboxUnavailableReason(t("form.sandboxUnavailable", { platform, reason }));
				return;
			}
			setSandboxUnavailableReason(null);
		});
	}, [t]);

	const workDirOptions = useMemo(() => {
		const seen = new Set<string>();
		const options: WorkDirOption[] = [];
		const add = (cwd: string | undefined, name?: string): void => {
			if (!cwd || seen.has(cwd)) return;
			seen.add(cwd);
			options.push({ cwd, name: name ?? projectName(cwd) });
		};
		add(defaultCwd, t("form.conversation"));
		add(value.cwd);
		for (const project of projects) add(project.cwd, project.name);
		return options;
	}, [defaultCwd, projects, projectName, value.cwd, t]);

	return useMemo(() => {
		const mode = schedule.mode === "weekly" ? "daily" : schedule.mode;
		const executionMode = value.executionMode ?? "inherit";

		return {
			defaultExecutionMode,
			executionIcon:
				executionMode === "sandbox"
					? "icon-[mdi--shield-lock-outline]"
					: executionMode === "full-access"
						? "icon-[mdi--shield-check-outline]"
						: "icon-[mdi--shield-outline]",
			executionLabel:
				executionMode === "sandbox"
					? t("form.useSandbox")
					: executionMode === "full-access"
						? t("form.fullAccess")
						: t("form.inherit", {
								mode: defaultExecutionMode === "sandbox" ? t("form.sandbox") : t("form.fullAccess"),
							}),
			executionMode,
			mode,
			namePlaceholderText: namePlaceholder ?? t("form.namePlaceholder"),
			sandboxUnavailableReason,
			schedule,
			scheduleLabel: describeSchedule(schedule, t),
			scheduleModes: [
				{ key: "once", label: t("scheduleMode.once") },
				{ key: "daily", label: t("scheduleMode.daily") },
				{ key: "interval", label: t("scheduleMode.interval") },
			],
			workDirOptions,
			onFieldChange: <Key extends keyof SchedulerTaskDraft>(key: Key, nextValue: SchedulerTaskDraft[Key]): void => {
				onChange({ ...value, [key]: nextValue });
			},
			onScheduleChange: (nextSchedule: Schedule): void => {
				setSchedule(nextSchedule);
				onChange({
					...value,
					cron: toCronExpression(nextSchedule),
					isOnce: nextSchedule.mode === "once",
				});
			},
		};
	}, [defaultExecutionMode, namePlaceholder, onChange, sandboxUnavailableReason, schedule, t, value, workDirOptions]);
}
