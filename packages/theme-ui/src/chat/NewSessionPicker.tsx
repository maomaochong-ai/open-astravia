import { Popover, PopoverContent, PopoverTrigger, cn } from "@vetta/ui";
import { Slot } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { createContext, forwardRef, useContext, useState } from "react";

interface PickerContextValue {
	readonly value: string | null;
	readonly onValueChange: (value: string | null) => void;
}

const PickerContext = createContext<PickerContextValue | null>(null);

function usePickerContext(part: string): PickerContextValue {
	const context = useContext(PickerContext);
	if (!context) throw new Error(`${part} must be used within NewSessionPicker.Root`);
	return context;
}

export interface NewSessionPickerRootProps {
	readonly open?: boolean;
	readonly defaultOpen?: boolean;
	readonly onOpenChange?: (open: boolean) => void;
	readonly value?: string | null;
	readonly defaultValue?: string | null;
	readonly onValueChange?: (value: string | null) => void;
	readonly children: ReactNode;
}

export function NewSessionPickerRoot({
	open,
	defaultOpen,
	onOpenChange,
	value,
	defaultValue = null,
	onValueChange,
	children,
}: NewSessionPickerRootProps): JSX.Element {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
	const [uncontrolledValue, setUncontrolledValue] = useState<string | null>(defaultValue);
	const resolvedOpen = open ?? uncontrolledOpen;
	const resolvedValue = value === undefined ? uncontrolledValue : value;
	const handleOpenChange = (next: boolean): void => {
		setUncontrolledOpen(next);
		onOpenChange?.(next);
	};
	const handleValueChange = (next: string | null): void => {
		setUncontrolledValue(next);
		onValueChange?.(next);
	};
	return (
		<PickerContext.Provider value={{ value: resolvedValue, onValueChange: handleValueChange }}>
			<Popover open={resolvedOpen} onOpenChange={handleOpenChange}>
				{children}
			</Popover>
		</PickerContext.Provider>
	);
}

export interface NewSessionPickerTriggerProps extends ComponentPropsWithoutRef<"button"> {
	readonly asChild?: boolean;
}

export const NewSessionPickerTrigger = forwardRef<HTMLButtonElement, NewSessionPickerTriggerProps>(
	function NewSessionPickerTrigger({ asChild = false, className, children, type, ...props }, ref) {
		const Comp = asChild ? Slot.Root : "button";
		return (
			<PopoverTrigger asChild>
				<Comp
					ref={ref}
					{...(asChild ? props : { ...props, type: type ?? "button" })}
					className={cn(
						"no-drag flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded-lg bg-accent/50 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground disabled:pointer-events-none disabled:opacity-60",
						className,
					)}
				>
					{children}
				</Comp>
			</PopoverTrigger>
		);
	},
);

export interface NewSessionPickerValueProps {
	readonly placeholder: string;
	readonly selectedLabel?: string | null;
	readonly icon?: ReactNode;
	readonly selectedIcon?: ReactNode;
	readonly triggerTitle?: string;
}

export function NewSessionPickerValue({
	placeholder,
	selectedLabel,
	icon,
	selectedIcon,
	triggerTitle,
}: NewSessionPickerValueProps): JSX.Element {
	return (
		<>
			<span className="h-3.5 w-3.5 shrink-0" aria-hidden>
				{selectedLabel ? selectedIcon ?? icon : icon}
			</span>
			<span className="min-w-0 truncate" title={triggerTitle}>
				{selectedLabel ?? placeholder}
			</span>
			<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 shrink-0 opacity-70" aria-hidden />
		</>
	);
}

export function NewSessionPickerContent({
	className,
	children,
}: {
	readonly className?: string;
	readonly children: ReactNode;
}): JSX.Element {
	return (
		<PopoverContent
			align="start"
			side="bottom"
			sideOffset={6}
			className={cn("w-[228px] gap-0 overflow-visible rounded-lg border border-border p-0", className)}
		>
			<div className="relative z-10 rounded-[inherit] p-1">{children}</div>
		</PopoverContent>
	);
}

export function NewSessionPickerSearch({
	value,
	onValueChange,
	placeholder,
	"aria-label": ariaLabel,
}: {
	readonly value: string;
	readonly onValueChange: (value: string) => void;
	readonly placeholder: string;
	readonly "aria-label"?: string;
}): JSX.Element {
	return (
		<input
			type="search"
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
			placeholder={placeholder}
			aria-label={ariaLabel ?? placeholder}
			className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-input"
		/>
	);
}

export function NewSessionPickerViewport({ children }: { readonly children: ReactNode }): JSX.Element {
	return <div className="max-h-[260px] overflow-y-auto">{children}</div>;
}

/**
 * 一组候选项。传 `label` 时额外渲染分组标题，并把同一文案挂到 listbox 的 aria-label 上：
 * 同一个下拉里出现多组时，每个 listbox 都必须有自己的名字，否则读屏只会听到若干个无名列表。
 */
export function NewSessionPickerGroup({
	label,
	children,
}: {
	readonly label?: string;
	readonly children: ReactNode;
}): JSX.Element {
	if (!label) return <div role="listbox">{children}</div>;
	return (
		<div>
			<p className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground/70">{label}</p>
			<div role="listbox" aria-label={label}>
				{children}
			</div>
		</div>
	);
}

export function NewSessionPickerItem({
	value,
	disabled = false,
	children,
	className,
}: {
	readonly value: string;
	readonly disabled?: boolean;
	readonly children: ReactNode;
	readonly className?: string;
}): JSX.Element {
	const context = usePickerContext("NewSessionPicker.Item");
	const selected = context.value === value;
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			disabled={disabled}
			onClick={() => context.onValueChange(value)}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[12px] font-medium transition-colors",
				selected ? "bg-accent text-foreground" : "text-foreground hover:bg-accent",
				"disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
		>
			{children}
		</button>
	);
}

export function NewSessionPickerItemIcon({ children }: { readonly children: ReactNode }): JSX.Element {
	return <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>{children}</span>;
}

export function NewSessionPickerItemText({ children }: { readonly children: ReactNode }): JSX.Element {
	return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

export function NewSessionPickerItemIndicator(): JSX.Element {
	return <span className="icon-[solar--check-circle-linear] h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />;
}

export function NewSessionPickerEmpty({ children }: { readonly children: ReactNode }): JSX.Element {
	return <p className="px-2 py-2 text-[12px] text-muted-foreground/70">{children}</p>;
}

export function NewSessionPickerLoading({ children }: { readonly children: ReactNode }): JSX.Element {
	return <p className="px-2 py-2 text-[12px] text-muted-foreground/70">{children}</p>;
}

export function NewSessionPickerError({ children }: { readonly children: ReactNode }): JSX.Element {
	return <p role="alert" className="px-2 py-2 text-[12px] text-destructive">{children}</p>;
}

export function NewSessionPickerClear({ children }: { readonly children: ReactNode }): JSX.Element {
	const context = usePickerContext("NewSessionPicker.Clear");
	return (
		<button
			type="button"
			onClick={() => context.onValueChange(null)}
			className="flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			<span className="icon-[solar--close-circle-linear] h-3.5 w-3.5 shrink-0" aria-hidden />
			<span className="truncate">{children}</span>
		</button>
	);
}

export function NewSessionPickerFooter({ children }: { readonly children: ReactNode }): JSX.Element {
	return <div className="mt-1 border-t border-border pt-1">{children}</div>;
}

export const NewSessionPicker = {
	Root: NewSessionPickerRoot,
	Trigger: NewSessionPickerTrigger,
	Value: NewSessionPickerValue,
	Content: NewSessionPickerContent,
	Search: NewSessionPickerSearch,
	Viewport: NewSessionPickerViewport,
	Group: NewSessionPickerGroup,
	Item: NewSessionPickerItem,
	ItemIcon: NewSessionPickerItemIcon,
	ItemText: NewSessionPickerItemText,
	ItemIndicator: NewSessionPickerItemIndicator,
	Empty: NewSessionPickerEmpty,
	Loading: NewSessionPickerLoading,
	Error: NewSessionPickerError,
	Clear: NewSessionPickerClear,
	Footer: NewSessionPickerFooter,
} as const;
