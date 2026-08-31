import type { ComponentProps } from "react";
import { useId, useState } from "react";
import { Button } from "./button";
import type { CalendarProps } from "./calendar";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { cn } from "./utils";

export interface DatePickerLabels {
	placeholder: string;
	clear: string;
	today: string;
	selected: string;
	month: string;
	year: string;
	previousMonth: string;
	nextMonth: string;
}

export interface DatePickerProps {
	value?: Date;
	onChange: (value: Date | undefined) => void;
	label: string;
	labels: DatePickerLabels;
	locale?: CalendarProps["locale"];
	/** Inclusive local calendar dates; time-of-day is ignored. */
	minDate?: Date;
	maxDate?: Date;
	disabled?: boolean;
	className?: string;
	"aria-invalid"?: ComponentProps<"button">["aria-invalid"];
	"aria-describedby"?: string;
}

function firstOfMonth(year: number, month: number): Date {
	const date = new Date(0);
	date.setFullYear(year, month, 1);
	date.setHours(0, 0, 0, 0);
	return date;
}

function localDay(date: Date): Date {
	const day = new Date(date);
	day.setHours(0, 0, 0, 0);
	return day;
}

export function DatePicker({
	value,
	onChange,
	label,
	labels,
	locale,
	minDate: minimum,
	maxDate: maximum,
	disabled,
	className,
	...aria
}: DatePickerProps) {
	const minDate = minimum ? localDay(minimum) : undefined;
	const maxDate = maximum ? localDay(maximum) : undefined;
	const [open, setOpen] = useState(false);
	const [month, setMonth] = useState(() => value ?? minDate ?? maxDate ?? new Date());
	const valueId = useId();
	const language = locale?.code;
	const dateFormat = new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric" });
	const dayFormat = new Intl.DateTimeFormat(language, { dateStyle: "full" });
	const monthFormat = new Intl.DateTimeFormat(language, { year: "numeric", month: "long" });
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const todayDisabled = Boolean((minDate && today < minDate) || (maxDate && today > maxDate));
	const select = (date: Date | undefined) => {
		onChange(date);
		setOpen(false);
	};
	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				if (nextOpen) setMonth(value ?? minDate ?? maxDate ?? new Date());
				setOpen(nextOpen);
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					disabled={disabled}
					aria-label={label}
					{...aria}
					aria-describedby={[valueId, aria["aria-describedby"]].filter(Boolean).join(" ")}
					className={cn(
						"w-full justify-start gap-2 text-[12px] font-normal transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/50",
						!value && "text-muted-foreground",
						className,
					)}
				>
					<span aria-hidden="true" className="icon-[solar--calendar-linear] size-3.5 shrink-0" />
					<span id={valueId} className="truncate">
						{value ? dateFormat.format(value) : labels.placeholder}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-label={label}
				collisionPadding={12}
				className="w-auto max-w-[calc(100vw-24px)] max-h-(--radix-popover-content-available-height) gap-0 overflow-y-auto rounded-xl p-0 shadow-md"
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<div className="border-b border-border/50 px-3 py-2 text-[12px] font-medium">{label}</div>
				<DatePickerNavigation
					month={month}
					onMonthChange={setMonth}
					locale={locale}
					labels={labels}
					minDate={minDate}
					maxDate={maxDate}
				/>
				<Calendar
					mode="single"
					required
					autoFocus
					selected={value}
					onSelect={select}
					month={month}
					onMonthChange={setMonth}
					locale={locale}
					hideNavigation
					startMonth={minDate ?? firstOfMonth(1, 0)}
					endMonth={maxDate ?? firstOfMonth(9999, 11)}
					disabled={[{ before: minDate ?? firstOfMonth(1, 0) }, { after: maxDate ?? new Date(9999, 11, 31) }]}
					className="p-2 pt-0"
					classNames={{ root: "w-full", month_caption: "hidden" }}
					labels={{
						labelGrid: (date) => monthFormat.format(date),
						labelDayButton: (date, modifiers) =>
							[dayFormat.format(date), modifiers.today && labels.today, modifiers.selected && labels.selected]
								.filter(Boolean)
								.join(", "),
						labelWeekday: (date) => date.toLocaleDateString(language, { weekday: "long" }),
					}}
				/>
				<div className="flex items-center justify-between border-t border-border/50 px-2 py-1.5">
					<Button type="button" variant="ghost" size="sm" disabled={todayDisabled} onClick={() => select(today)}>
						{labels.today}
					</Button>
					<Button type="button" variant="ghost" size="sm" disabled={!value} onClick={() => select(undefined)}>
						{labels.clear}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function DatePickerNavigation({
	month,
	onMonthChange,
	locale,
	labels,
	minDate,
	maxDate,
}: Pick<DatePickerProps, "locale" | "labels" | "minDate" | "maxDate"> & {
	month: Date;
	onMonthChange: (month: Date) => void;
}) {
	const year = month.getFullYear();
	const first = firstOfMonth(minDate?.getFullYear() ?? 1, minDate?.getMonth() ?? 0);
	const last = firstOfMonth(maxDate?.getFullYear() ?? 9999, maxDate?.getMonth() ?? 11);
	const previous = firstOfMonth(year, month.getMonth() - 1);
	const next = firstOfMonth(year, month.getMonth() + 1);
	const change = (date: Date) => onMonthChange(date < first ? first : date > last ? last : date);
	// A sliding year window keeps the menu bounded even for century-spanning history.
	const firstYear = Math.max(first.getFullYear(), year - 50);
	const lastYear = Math.min(last.getFullYear(), year + 50);
	return (
		<div className="flex items-center justify-between gap-1 px-2 py-2">
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={labels.previousMonth}
				disabled={previous < first}
				onClick={() => change(previous)}
			>
				<span aria-hidden="true" className="icon-[solar--alt-arrow-left-linear] size-3.5 rtl:rotate-180" />
			</Button>
			<Select value={String(month.getMonth())} onValueChange={(value) => change(firstOfMonth(year, Number(value)))}>
				<SelectTrigger
					size="sm"
					aria-label={labels.month}
					className="min-w-0 border-transparent bg-transparent px-1.5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/50"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent className="min-w-28">
					{Array.from({ length: 12 }, (_, index) => {
						const date = firstOfMonth(year, index);
						return (
							<SelectItem key={index} value={String(index)} disabled={date < first || date > last}>
								{date.toLocaleDateString(locale?.code, { month: "long" })}
							</SelectItem>
						);
					})}
				</SelectContent>
			</Select>
			<Select value={String(year)} onValueChange={(value) => change(firstOfMonth(Number(value), month.getMonth()))}>
				<SelectTrigger
					size="sm"
					aria-label={labels.year}
					className="border-transparent bg-transparent px-1.5 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/50"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent className="min-w-20">
					{Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index).map((value) => (
						<SelectItem key={value} value={String(value)}>
							{value}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={labels.nextMonth}
				disabled={next > last}
				onClick={() => change(next)}
			>
				<span aria-hidden="true" className="icon-[solar--alt-arrow-right-linear] size-3.5 rtl:rotate-180" />
			</Button>
		</div>
	);
}
