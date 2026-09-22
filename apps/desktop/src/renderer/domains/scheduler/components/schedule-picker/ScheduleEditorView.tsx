import { Popover, PopoverContent, PopoverTrigger, cn } from "@vetta-org/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AUTOMATION_INTERVAL_MAX_MINUTES,
	type AutomationMonthDay,
	type AutomationSchedule,
	type AutomationScheduleKind,
} from "../../../../../shared/automation";
import {
	CRON_FIELDS,
	type CronFieldSpec,
	formatCronField,
	pad2,
	parseCronField,
	splitCron,
} from "./automation-schedule";

export interface ScheduleEditorViewProps {
	readonly kinds: readonly { readonly kind: AutomationScheduleKind; readonly label: string }[];
	readonly schedule: AutomationSchedule;
	readonly onKindChange: (kind: AutomationScheduleKind) => void;
	readonly onChange: (schedule: AutomationSchedule) => void;
}

const inputClass =
	"h-8 rounded-md border border-border/50 bg-background/60 px-2 text-[12px] text-foreground focus:outline-none [color-scheme:light_dark]";

function chipClass(selected: boolean): string {
	return cn(
		"flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[11px] tabular-nums transition-colors",
		selected ? "bg-primary/15 text-primary" : "bg-muted/50 text-muted-foreground hover:text-foreground",
	);
}

export function ScheduleEditorView({ kinds, schedule, onKindChange, onChange }: ScheduleEditorViewProps): JSX.Element {
	return (
		<div className="space-y-2">
			<div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted/50 p-0.5">
				{kinds.map((option) => (
					<button
						key={option.kind}
						type="button"
						aria-pressed={option.kind === schedule.kind}
						onClick={() => onKindChange(option.kind)}
						className={cn(
							"h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors",
							option.kind === schedule.kind
								? "bg-card text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				))}
			</div>
			<KindEditor schedule={schedule} onChange={onChange} />
		</div>
	);
}

function KindEditor({
	schedule,
	onChange,
}: {
	readonly schedule: AutomationSchedule;
	readonly onChange: (schedule: AutomationSchedule) => void;
}): JSX.Element {
	const { t } = useTranslation("automation");
	switch (schedule.kind) {
		case "once": {
			const date = new Date(schedule.at);
			const value = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
			return (
				<input
					type="datetime-local"
					aria-label={t("scheduleMode.once")}
					value={value}
					onChange={(event) => {
						const next = new Date(event.target.value);
						if (!Number.isNaN(next.getTime())) onChange({ kind: "once", at: next.getTime() });
					}}
					className={inputClass}
				/>
			);
		}
		case "interval":
			return (
				<div className="space-y-1">
					<label className="flex items-center gap-2 text-[12px] text-muted-foreground">
						{t("form.intervalPrefix")}
						<input
							type="number"
							min={1}
							max={AUTOMATION_INTERVAL_MAX_MINUTES}
							value={schedule.everyMinutes}
							onChange={(event) => {
								const everyMinutes = Number.parseInt(event.target.value, 10);
								// 改了间隔就从现在重新起算，下一次在 n 分钟后。
								if (everyMinutes >= 1 && everyMinutes <= AUTOMATION_INTERVAL_MAX_MINUTES) {
									onChange({ kind: "interval", everyMinutes, startAt: Date.now() });
								}
							}}
							className={cn(inputClass, "w-20 text-center")}
						/>
						{t("form.intervalSuffix")}
					</label>
					<p className="text-[11px] text-muted-foreground/60">{t("form.intervalHint")}</p>
				</div>
			);
		case "hourly":
			return (
				<label className="flex items-center gap-2 text-[12px] text-muted-foreground">
					{t("form.atMinutePrefix")}
					<input
						type="number"
						min={0}
						max={59}
						value={schedule.minute}
						onChange={(event) => {
							const minute = Number.parseInt(event.target.value, 10);
							if (minute >= 0 && minute <= 59) onChange({ kind: "hourly", minute });
						}}
						className={cn(inputClass, "w-16 text-center")}
					/>
					{t("form.atMinuteSuffix")}
				</label>
			);
		case "daily":
			return <TimeInput schedule={schedule} onChange={(time) => onChange({ ...schedule, ...time })} />;
		case "weekly": {
			const names = t("schedule.weekdayNames", { returnObjects: true }) as string[];
			// 周一在前，符合日常习惯；取值仍是 cron 的 0 = 周日。
			const order = [1, 2, 3, 4, 5, 6, 0];
			return (
				<div className="space-y-2">
					<div className="flex flex-wrap gap-1">
						{order.map((day) => {
							const selected = schedule.weekdays.includes(day);
							return (
								<button
									key={day}
									type="button"
									aria-pressed={selected}
									onClick={() =>
										onChange({
											...schedule,
											weekdays: selected
												? schedule.weekdays.filter((value) => value !== day)
												: [...schedule.weekdays, day],
										})
									}
									className={chipClass(selected)}
								>
									{names[day]}
								</button>
							);
						})}
					</div>
					<TimeInput schedule={schedule} onChange={(time) => onChange({ ...schedule, ...time })} />
				</div>
			);
		}
		case "monthly": {
			const toggle = (day: AutomationMonthDay): void => {
				const selected = schedule.days.includes(day);
				onChange({
					...schedule,
					days: selected ? schedule.days.filter((value) => value !== day) : [...schedule.days, day],
				});
			};
			return (
				<div className="space-y-2">
					<div className="grid grid-cols-7 gap-1">
						{Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
							<button
								key={day}
								type="button"
								aria-pressed={schedule.days.includes(day)}
								onClick={() => toggle(day)}
								className={chipClass(schedule.days.includes(day))}
							>
								{day}
							</button>
						))}
						<button
							type="button"
							aria-pressed={schedule.days.includes("last")}
							onClick={() => toggle("last")}
							className={cn(chipClass(schedule.days.includes("last")), "col-span-3")}
						>
							{t("schedule.lastDay")}
						</button>
					</div>
					<p className="text-[11px] text-muted-foreground/60">{t("form.monthlyShortMonthHint")}</p>
					<TimeInput schedule={schedule} onChange={(time) => onChange({ ...schedule, ...time })} />
				</div>
			);
		}
		case "custom":
			return <CustomCronEditor cron={schedule.cron} onChange={(cron) => onChange({ kind: "custom", cron })} />;
	}
}

function TimeInput({
	schedule,
	onChange,
}: {
	readonly schedule: { readonly hour: number; readonly minute: number };
	readonly onChange: (time: { hour: number; minute: number }) => void;
}): JSX.Element {
	const { t } = useTranslation("automation");
	return (
		<input
			type="time"
			aria-label={t("form.time")}
			value={`${pad2(schedule.hour)}:${pad2(schedule.minute)}`}
			onChange={(event) => {
				const [hour, minute] = event.target.value.split(":").map(Number);
				if (Number.isInteger(hour) && Number.isInteger(minute)) onChange({ hour, minute });
			}}
			className={inputClass}
		/>
	);
}

/** 五段可视化多选与 cron 文本实时互相同步；文本里有可视化表达不了的写法时，对应段只读。 */
function CustomCronEditor({
	cron,
	onChange,
}: {
	readonly cron: string;
	readonly onChange: (cron: string) => void;
}): JSX.Element {
	const { t } = useTranslation("automation");
	const [text, setText] = useState(cron);
	useEffect(() => setText(cron), [cron]);
	const fields = splitCron(cron);
	const valid = fields.length === 5;

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-1.5">
				{CRON_FIELDS.map((spec, index) => (
					<CronFieldPicker
						key={spec.key}
						spec={spec}
						field={valid ? fields[index] : "*"}
						onChange={(nextField) => {
							const next = valid ? [...fields] : ["*", "*", "*", "*", "*"];
							next[index] = nextField;
							onChange(next.join(" "));
						}}
					/>
				))}
			</div>
			<input
				type="text"
				spellCheck={false}
				aria-label={t("form.cronExpression")}
				value={text}
				onChange={(event) => {
					setText(event.target.value);
					if (splitCron(event.target.value).length === 5) onChange(event.target.value.trim());
				}}
				className={cn(inputClass, "w-full font-mono", !valid && "border-destructive/60")}
				placeholder="0 9 * * 1-5"
			/>
			<p className="text-[11px] text-muted-foreground/60">{t("form.cronHint")}</p>
		</div>
	);
}

function CronFieldPicker({
	spec,
	field,
	onChange,
}: {
	readonly spec: CronFieldSpec;
	readonly field: string;
	readonly onChange: (field: string) => void;
}): JSX.Element {
	const { t } = useTranslation("automation");
	const parsed = parseCronField(field, spec);
	const values = Array.from({ length: spec.max - spec.min + 1 }, (_, index) => spec.min + index);
	const names = spec.key === "weekday" ? (t("schedule.weekdayNames", { returnObjects: true }) as string[]) : null;
	const summary = parsed === null ? t("form.cronAny") : field;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					disabled={parsed === undefined}
					title={parsed === undefined ? t("form.cronTextOnly") : undefined}
					className="flex h-8 items-center gap-1.5 rounded-md border border-border/50 bg-card/40 px-2 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-60"
				>
					<span>{t(`form.cronField.${spec.key}`)}</span>
					<span className="max-w-[90px] truncate font-mono text-foreground">{summary}</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-2">
				<button
					type="button"
					aria-pressed={parsed === null}
					onClick={() => onChange("*")}
					className={cn(chipClass(parsed === null), "mb-1.5 w-full")}
				>
					{t("form.cronAny")}
				</button>
				<div className={cn("grid gap-1", spec.key === "minute" ? "grid-cols-10" : "grid-cols-7")}>
					{values.map((value) => {
						const selected = parsed?.has(value) ?? false;
						return (
							<button
								key={value}
								type="button"
								aria-pressed={selected}
								onClick={() => {
									const next = new Set(parsed ?? []);
									if (selected) next.delete(value);
									else next.add(value);
									onChange(formatCronField(next.size > 0 ? next : null));
								}}
								className={chipClass(selected)}
							>
								{names ? names[value] : value}
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
