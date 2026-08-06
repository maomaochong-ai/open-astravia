import type { JSX, KeyboardEvent } from "react";
import { cn } from "@vetta/ui";
import { MotionSelect } from "./MotionSelect";

/**
 * @deprecated 基础 Select 已产品化；设置页请优先 {@link MotionSelect}。
 * 保留空串兼容旧 `cn(SETTINGS_SELECT_TRIGGER_CLASS, …)` 调用。
 */
export const SETTINGS_SELECT_TRIGGER_CLASS = "";

/** @deprecated 见上。 */
export const SETTINGS_SELECT_ITEM_CLASS = "";

export function SelectField({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (v: string) => void;
	options: { value: string; label: string }[];
}): JSX.Element {
	return (
		<MotionSelect
			value={value}
			onValueChange={onChange}
			options={options}
			triggerClassName="w-full"
		/>
	);
}

export function InputField({
	value,
	onChange,
	placeholder,
	type = "text",
	disabled,
	onBlur,
	onKeyDown,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: string;
	disabled?: boolean;
	onBlur?: () => void;
	onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}): JSX.Element {
	return (
		<input
			type={type}
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			onBlur={onBlur}
			onKeyDown={onKeyDown}
			placeholder={placeholder}
			className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors hover:bg-accent focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
		/>
	);
}

export function TextareaField({
	value,
	onChange,
	placeholder,
	rows = 3,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	rows?: number;
}): JSX.Element {
	return (
		<textarea
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			rows={rows}
			className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors hover:bg-accent focus-visible:border-primary/50"
		/>
	);
}

export function CheckboxField({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (v: boolean) => void;
	label: string;
}): JSX.Element {
	return (
		<label className="flex cursor-pointer select-none items-center gap-2">
			<button
				type="button"
				onClick={() => onChange(!checked)}
				className={cn(
					"flex h-4 w-4 items-center justify-center rounded border transition-colors",
					checked ? "border-primary bg-primary" : "border-border bg-card hover:bg-accent",
				)}
			>
				{checked && <span className="icon-[mdi--check] h-3 w-3 text-primary-foreground" />}
			</button>
			<span className="text-[12px] text-foreground">{label}</span>
		</label>
	);
}
