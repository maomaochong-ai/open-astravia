import type { FocusEventHandler, JSX, KeyboardEvent } from "react";
import { cn, INPUT_FILL_CLASS, Input, TEXTAREA_FILL_CLASS } from "@astravia-org/ui";
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
	autoFocus,
	"aria-label": ariaLabel,
	className,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: string;
	disabled?: boolean;
	onBlur?: FocusEventHandler<HTMLInputElement>;
	onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
	autoFocus?: boolean;
	"aria-label"?: string;
	className?: string;
}): JSX.Element {
	return (
		<Input
			type={type}
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			onBlur={onBlur}
			onKeyDown={onKeyDown}
			placeholder={placeholder}
			autoFocus={autoFocus}
			aria-label={ariaLabel}
			className={cn(INPUT_FILL_CLASS, className)}
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
			className={cn(TEXTAREA_FILL_CLASS, "w-full resize-none font-mono")}
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
