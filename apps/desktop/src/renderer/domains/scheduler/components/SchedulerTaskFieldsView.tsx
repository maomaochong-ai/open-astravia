import { TaskFormDialogView } from "@vetta/theme-ui/scheduler";
import { SkillPromptArea } from "@domains/chat/components/SkillPromptArea";
import { ModelSelect } from "@shared/components/ModelSelect";
import { Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CompactScheduleMode,
	SchedulerTaskFieldsModel,
} from "../hooks/useSchedulerTaskFieldsModel";
import {
	getDefaultDailySchedule,
	getDefaultIntervalSchedule,
	getDefaultOnceSchedule,
	type DailySchedule,
	type IntervalSchedule,
	type OnceSchedule,
	type Schedule,
} from "./schedule-picker/cron-utils";
import type { SchedulerTaskDraft } from "./SchedulerTaskFields";

export interface SchedulerTaskFieldsViewProps extends SchedulerTaskFieldsModel {
	readonly promptMinHeight: number;
	readonly showEnabled: boolean;
	readonly showWorkDirSelector: boolean;
	readonly value: SchedulerTaskDraft;
}

function getDefaultSchedule(mode: CompactScheduleMode): Schedule {
	switch (mode) {
		case "once":
			return getDefaultOnceSchedule();
		case "daily":
			return getDefaultDailySchedule();
		case "interval":
			return getDefaultIntervalSchedule();
	}
}

export function SchedulerTaskFieldsView({
	defaultExecutionMode,
	executionIcon,
	executionLabel,
	executionMode,
	mode,
	namePlaceholderText,
	promptMinHeight,
	sandboxUnavailableReason,
	schedule,
	scheduleLabel,
	scheduleModes,
	showEnabled,
	showWorkDirSelector,
	value,
	workDirOptions,
	onFieldChange,
	onScheduleChange,
}: SchedulerTaskFieldsViewProps): JSX.Element {
	const { t } = useTranslation("automation");
	const [workDirPopoverOpen, setWorkDirPopoverOpen] = useState(false);
	const [schedulePopoverOpen, setSchedulePopoverOpen] = useState(false);
	const [executionPopoverOpen, setExecutionPopoverOpen] = useState(false);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/20">
					<span className="icon-[mdi--clock-time-eight-outline] h-4 w-4 text-primary" />
				</div>
				<input
					type="text"
					value={value.name ?? ""}
					onChange={(event) => onFieldChange("name", event.target.value)}
					className="w-full border-none bg-transparent text-[15px] font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none! focus-visible:outline-none! focus:shadow-none! focus-visible:shadow-none!"
					placeholder={namePlaceholderText}
				/>
			</div>

			<SkillPromptArea
				prompt={value.prompt ?? ""}
				onPromptChange={(prompt) => onFieldChange("prompt", prompt)}
				skill={value.skill ?? null}
				onSkillChange={(skill) => onFieldChange("skill", skill)}
				placeholder={t("form.promptPlaceholder")}
				minHeight={promptMinHeight}
				cwd={value.cwd}
			/>

			<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/30 p-3">
				{showWorkDirSelector && (
					<Popover open={workDirPopoverOpen} onOpenChange={setWorkDirPopoverOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								className="flex h-8 items-center gap-1.5 rounded-lg border border-border/50 bg-card/40 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card/70 hover:text-foreground"
							>
								<span className="icon-[mdi--folder-outline] h-3.5 w-3.5" />
								<span className="max-w-[140px] truncate">
									{workDirOptions.find((option) => option.cwd === value.cwd)?.name ?? t("form.selectWorkDir")}
								</span>
								<span className="icon-[mdi--chevron-down] h-3.5 w-3.5 opacity-60" />
							</button>
						</PopoverTrigger>
						<PopoverContent align="start" className="w-56 p-1">
							{workDirOptions.map((option) => (
								<button
									key={option.cwd}
									type="button"
									onClick={() => {
										onFieldChange("cwd", option.cwd);
										setWorkDirPopoverOpen(false);
									}}
									className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${
										value.cwd === option.cwd ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent/50"
									}`}
								>
									<span className="icon-[mdi--folder-outline] h-3.5 w-3.5" />
									<span className="truncate">{option.name}</span>
								</button>
							))}
						</PopoverContent>
					</Popover>
				)}

				<Popover open={schedulePopoverOpen} onOpenChange={setSchedulePopoverOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="flex h-8 items-center gap-1.5 rounded-lg border border-border/50 bg-card/40 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card/70 hover:text-foreground"
						>
							<span className="icon-[mdi--clock-outline] h-3.5 w-3.5" />
							<span className="max-w-[180px] truncate">{scheduleLabel}</span>
							<span className="icon-[mdi--chevron-down] h-3.5 w-3.5 opacity-60" />
						</button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-72 p-3">
						<div className="mb-2.5 flex gap-1">
							{scheduleModes.map((scheduleMode) => (
								<button
									key={scheduleMode.key}
									type="button"
									onClick={() => onScheduleChange(getDefaultSchedule(scheduleMode.key))}
									className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
										mode === scheduleMode.key
											? "bg-primary/10 text-primary"
											: "text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground"
									}`}
								>
									{scheduleMode.label}
								</button>
							))}
						</div>
						{mode === "once" && (
							<OnceEditor schedule={schedule as OnceSchedule} onChange={onScheduleChange} />
						)}
						{mode === "daily" && (
							<DailyEditor schedule={schedule as DailySchedule} onChange={onScheduleChange} />
						)}
						{mode === "interval" && (
							<IntervalEditor schedule={schedule as IntervalSchedule} onChange={onScheduleChange} />
						)}
					</PopoverContent>
				</Popover>

				<Popover open={executionPopoverOpen} onOpenChange={setExecutionPopoverOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="flex h-8 items-center gap-1.5 rounded-lg border border-border/50 bg-card/40 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card/70 hover:text-foreground"
						>
							<span className={`${executionIcon} h-3.5 w-3.5`} />
							<span className="max-w-[140px] truncate">{executionLabel}</span>
							<span className="icon-[mdi--chevron-down] h-3.5 w-3.5 opacity-60" />
						</button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-56 p-1">
						{[
							{ value: "inherit" as const, label: t("form.inherit", { mode: defaultExecutionMode === "sandbox" ? t("form.sandbox") : t("form.fullAccess") }), icon: "icon-[mdi--shield-outline]" },
							{ value: "full-access" as const, label: t("form.fullAccess"), icon: "icon-[mdi--shield-check-outline]" },
							{ value: "sandbox" as const, label: t("form.useSandbox"), icon: "icon-[mdi--shield-lock-outline]", disabled: Boolean(sandboxUnavailableReason) },
						].map((option) => {
							const isSelected = executionMode === option.value;
							return (
								<button
									key={option.value}
									type="button"
									disabled={option.disabled}
									title={option.disabled ? sandboxUnavailableReason ?? undefined : undefined}
									onClick={() => {
										onFieldChange("executionMode", option.value);
										setExecutionPopoverOpen(false);
									}}
									className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
										isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent/50"
									}`}
								>
									<span className={`${option.icon} h-3.5 w-3.5`} />
									<span className="flex-1 truncate text-left">{option.label}</span>
									{isSelected && <span className="icon-[mdi--check] h-3.5 w-3.5" />}
								</button>
							);
						})}
					</PopoverContent>
				</Popover>

				<ModelSelect
					value={value.modelKey ?? null}
					onChange={(key) => onFieldChange("modelKey", key)}
					placeholder={t("form.modelSelect")}
					triggerClassName="h-8 rounded-lg border-border/50 bg-card/40 px-2.5 text-muted-foreground hover:border-primary/30 hover:bg-card/70 hover:text-foreground"
				/>

				{showEnabled && (
					<button
						type="button"
						onClick={() => onFieldChange("enabled", !(value.enabled ?? true))}
						className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors ${
							value.enabled ?? true
								? "border-primary/30 bg-primary/10 text-primary"
								: "border-border/50 bg-card/40 text-muted-foreground hover:bg-card/70 hover:text-foreground"
						}`}
					>
						<span className={`${value.enabled ?? true ? "icon-[mdi--toggle-switch]" : "icon-[mdi--toggle-switch-off-outline]"} h-3.5 w-3.5`} />
						<span>{value.enabled ?? true ? t("form.enabled") : t("form.disabled")}</span>
					</button>
				)}
			</div>
		</div>
	);
}

function OnceEditor({
	schedule,
	onChange,
}: {
	readonly schedule: OnceSchedule;
	readonly onChange: (schedule: OnceSchedule) => void;
}): JSX.Element {
	const value = `${schedule.year}-${String(schedule.month).padStart(2, "0")}-${String(schedule.day).padStart(2, "0")}T${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;

	return (
		<input
			type="datetime-local"
			value={value}
			onChange={(event) => {
				const date = new Date(event.target.value);
				if (Number.isNaN(date.getTime())) return;
				onChange({
					...schedule,
					year: date.getFullYear(),
					month: date.getMonth() + 1,
					day: date.getDate(),
					hour: date.getHours(),
					minute: date.getMinutes(),
				});
			}}
			className="h-9 rounded-lg border-none bg-muted px-3 text-sm text-foreground focus:outline-none [color-scheme:dark]"
		/>
	);
}

function DailyEditor({
	schedule,
	onChange,
}: {
	readonly schedule: DailySchedule;
	readonly onChange: (schedule: DailySchedule) => void;
}): JSX.Element {
	const timeValue = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;

	return (
		<input
			type="time"
			value={timeValue}
			onChange={(event) => {
				const [hour, minute] = event.target.value.split(":").map(Number);
				if (hour != null && minute != null) onChange({ ...schedule, hour, minute });
			}}
			className="h-9 rounded-lg border-none bg-muted px-3 text-sm text-foreground focus:outline-none [color-scheme:dark]"
		/>
	);
}

function IntervalEditor({
	schedule,
	onChange,
}: {
	readonly schedule: IntervalSchedule;
	readonly onChange: (schedule: IntervalSchedule) => void;
}): JSX.Element {
	const { t } = useTranslation("automation");
	const [unit, setUnit] = useState<"hours" | "days">(() =>
		schedule.intervalHours >= 24 && schedule.intervalHours % 24 === 0 ? "days" : "hours",
	);
	const displayValue = unit === "days" ? schedule.intervalHours / 24 : schedule.intervalHours;

	return (
		<div className="flex items-center gap-2">
			<span className="text-sm text-muted-foreground">{t("form.every")}</span>
			<input
				type="number"
				value={displayValue}
				min={1}
				onChange={(event) => {
					const value = Number.parseInt(event.target.value, 10);
					if (!Number.isNaN(value) && value >= 1) {
						onChange({ ...schedule, intervalHours: unit === "days" ? value * 24 : value });
					}
				}}
				className="h-9 w-16 rounded-lg border-none bg-muted px-2 text-center text-sm text-foreground focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<select
				value={unit}
				onChange={(event) => {
					const nextUnit = event.target.value as "hours" | "days";
					setUnit(nextUnit);
					if (nextUnit === "days") {
						onChange({ ...schedule, intervalHours: Math.max(1, Math.round(schedule.intervalHours / 24)) * 24 });
					} else {
						onChange({ ...schedule, intervalHours: Math.max(1, schedule.intervalHours) });
					}
				}}
				className="h-9 rounded-lg border-none bg-muted px-2 pr-6 text-sm text-foreground focus:outline-none"
			>
				<option value="hours">{t("form.unitHours")}</option>
				<option value="days">{t("form.unitDays")}</option>
			</select>
		</div>
	);
}

export type ThemeUiLink_TaskFormDialogView = typeof TaskFormDialogView;
