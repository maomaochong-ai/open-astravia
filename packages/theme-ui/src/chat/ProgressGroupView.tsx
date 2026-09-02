import { Slot } from "radix-ui";
import {
	createContext,
	forwardRef,
	type ButtonHTMLAttributes,
	type ComponentPropsWithoutRef,
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useId,
	useMemo,
	useState,
} from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

const ROW_BUTTON =
	"inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors";

interface ProgressGroupContextValue {
	readonly done: boolean;
	readonly expanded: boolean;
	readonly exportMode: boolean;
	readonly hasRows: boolean;
	readonly open: boolean;
	readonly panelId?: string;
	readonly toggle: () => void;
}

const ProgressGroupContext = createContext<ProgressGroupContextValue | null>(null);

export interface ProgressGroupRootProps {
	readonly blockCount: number;
	readonly children: ReactNode;
	readonly done: boolean;
	readonly expanded?: boolean;
	readonly exportMode?: boolean;
	readonly onToggle?: () => void;
}

export function ProgressGroupRoot({
	blockCount,
	children,
	done,
	exportMode = false,
	expanded: expandedProp,
	onToggle,
}: ProgressGroupRootProps): JSX.Element {
	const [uncontrolled, setUncontrolled] = useState(false);
	const expanded = expandedProp ?? uncontrolled;
	const toggle = useCallback(
		() => (onToggle ? onToggle() : setUncontrolled((value) => !value)),
		[onToggle],
	);
	const generatedId = useId();
	const panelId = exportMode ? `export-progress-group-${generatedId}` : undefined;
	const open = expanded || exportMode;
	const hasRows = blockCount > 0;
	const value = useMemo(
		() => ({ done, expanded, exportMode, hasRows, open, panelId, toggle }),
		[done, expanded, exportMode, hasRows, open, panelId, toggle],
	);
	return <ProgressGroupContext.Provider value={value}>{children}</ProgressGroupContext.Provider>;
}

function useProgressGroupContext(part: string): ProgressGroupContextValue {
	const context = useContext(ProgressGroupContext);
	if (!context) throw new Error(`${part} must be used within ProgressGroup.Root`);
	return context;
}

export interface ProgressGroupPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export const ProgressGroupFrame = forwardRef<HTMLDivElement, ProgressGroupPrimitiveProps>(
	function ProgressGroupFrame({ asChild = false, className, ...props }, forwardedRef) {
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={`min-w-0 w-full${className ? ` ${className}` : ""}`}
				{...props}
			/>
		);
	},
);

export interface ProgressGroupTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	readonly asChild?: boolean;
}

export const ProgressGroupTrigger = forwardRef<HTMLButtonElement, ProgressGroupTriggerProps>(
	function ProgressGroupTrigger(
		{ asChild = false, className, onClick, type, ...props },
		forwardedRef,
	) {
		const { hasRows, open, panelId, toggle } = useProgressGroupContext("ProgressGroup.Trigger");
		const Comp = asChild ? Slot.Root : "button";
		return (
			<Comp
				ref={forwardedRef}
				type={asChild ? undefined : (type ?? "button")}
				onClick={(event) => {
					onClick?.(event);
					if (!event.defaultPrevented && hasRows) toggle();
				}}
				data-export-toggle={panelId}
				aria-expanded={open}
				disabled={!hasRows}
				className={`${ROW_BUTTON} enabled:hover:bg-muted/60${className ? ` ${className}` : ""}`}
				{...props}
			/>
		);
	},
);

export function ProgressGroupStatus(): JSX.Element {
	const { done } = useProgressGroupContext("ProgressGroup.Status");
	return (
		<span
			className={
				done
					? "icon-[solar--check-circle-linear] h-3.5 w-3.5 shrink-0 text-emerald-400"
					: "icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/60"
			}
		/>
	);
}

interface ProgressGroupTextPrimitiveProps extends ComponentPropsWithoutRef<"span"> {
	readonly asChild?: boolean;
}

export const ProgressGroupTitle = forwardRef<HTMLSpanElement, ProgressGroupTextPrimitiveProps>(
	function ProgressGroupTitle({ asChild = false, className, ...props }, forwardedRef) {
		const { done } = useProgressGroupContext("ProgressGroup.Title");
		const Comp = asChild ? Slot.Root : "span";
		return (
			<Comp
				ref={forwardedRef}
				className={`min-w-0 truncate text-[13px] ${done ? "text-muted-foreground" : "tool-call-shimmer-text"}${className ? ` ${className}` : ""}`}
				{...props}
			/>
		);
	},
);

export function ProgressGroupChevron(): JSX.Element | null {
	const { hasRows, open } = useProgressGroupContext("ProgressGroup.Chevron");
	if (!hasRows) return null;
	return (
		<span
			className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
		/>
	);
}

export function ProgressGroupContent({ children }: { readonly children: ReactNode }): JSX.Element {
	const { expanded, exportMode, hasRows, open, panelId } =
		useProgressGroupContext("ProgressGroup.Content");
	return (
		<CollapsePanel
			open={open && hasRows}
			id={panelId}
			exportPanel={exportMode}
			hidden={exportMode && !expanded}
		>
			<div className="ml-4 flex flex-col gap-0.5 border-border/50 border-l pb-1 pl-3">{children}</div>
		</CollapsePanel>
	);
}

interface ProgressGroupRowContextValue {
	readonly exportMode: boolean;
	readonly open: boolean;
	readonly toggle: () => void;
}

const ProgressGroupRowContext = createContext<ProgressGroupRowContextValue | null>(null);

export interface ProgressGroupRowRootProps {
	readonly children: ReactNode;
	readonly exportMode?: boolean;
	readonly expanded?: boolean;
	readonly onToggle?: () => void;
}

export function ProgressGroupRowRoot({
	children,
	exportMode = false,
	expanded,
	onToggle,
}: ProgressGroupRowRootProps): JSX.Element {
	const [uncontrolled, setUncontrolled] = useState(false);
	const open = expanded ?? uncontrolled;
	const toggle = onToggle ?? ((): void => setUncontrolled(!uncontrolled));
	const value = useMemo(() => ({ exportMode, open, toggle }), [exportMode, open, toggle]);
	return <ProgressGroupRowContext.Provider value={value}>{children}</ProgressGroupRowContext.Provider>;
}

function useProgressGroupRowContext(part: string): ProgressGroupRowContextValue {
	const context = useContext(ProgressGroupRowContext);
	if (!context) throw new Error(`${part} must be used within ProgressGroup.RowRoot`);
	return context;
}

export interface ProgressGroupRowPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

export const ProgressGroupRowFrame = forwardRef<
	HTMLDivElement,
	ProgressGroupRowPrimitiveProps
>(function ProgressGroupRowFrame({ asChild = false, className, ...props }, forwardedRef) {
	const Comp = asChild ? Slot.Root : "div";
	return (
		<Comp
			ref={forwardedRef}
			className={`flex min-w-0 w-full flex-col gap-0.5${className ? ` ${className}` : ""}`}
			{...props}
		/>
	);
});

export interface ProgressGroupRowTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	readonly asChild?: boolean;
}

export const ProgressGroupRowTrigger = forwardRef<
	HTMLButtonElement,
	ProgressGroupRowTriggerProps
>(function ProgressGroupRowTrigger(
	{ asChild = false, className, disabled, onClick, type, ...props },
	forwardedRef,
) {
	const { exportMode, open, toggle } = useProgressGroupRowContext("ProgressGroup.RowTrigger");
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			ref={forwardedRef}
			type={asChild ? undefined : (type ?? "button")}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented && !disabled) toggle();
			}}
			aria-expanded={open || exportMode}
			disabled={disabled}
			className={`${ROW_BUTTON} enabled:hover:bg-muted/50${className ? ` ${className}` : ""}`}
			{...props}
		/>
	);
});

export function ProgressGroupRowStatus({
	status,
}: {
	readonly status: "pending" | "success" | "error";
}): JSX.Element {
	return (
		<span
			className={
				status === "pending"
					? "icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/50"
					: status === "error"
						? "icon-[solar--danger-circle-linear] h-3.5 w-3.5 shrink-0 text-destructive/70"
						: "icon-[solar--check-read-linear] h-3.5 w-3.5 shrink-0 text-emerald-400"
			}
		/>
	);
}

export const ProgressGroupRowText = forwardRef<
	HTMLSpanElement,
	ProgressGroupTextPrimitiveProps
>(function ProgressGroupRowText({ asChild = false, className, ...props }, forwardedRef) {
	const Comp = asChild ? Slot.Root : "span";
	return (
		<Comp
			ref={forwardedRef}
			className={`min-w-0 truncate text-[12px] text-muted-foreground/80${className ? ` ${className}` : ""}`}
			{...props}
		/>
	);
});

export function ProgressGroupRowChevron(): JSX.Element {
	const { exportMode, open } = useProgressGroupRowContext("ProgressGroup.RowChevron");
	return (
		<span
			className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${open || exportMode ? "rotate-90" : ""}`}
		/>
	);
}

export function ProgressGroupRowContent({ children }: { readonly children: ReactNode }): JSX.Element {
	const { exportMode, open } = useProgressGroupRowContext("ProgressGroup.RowContent");

	return (
		<CollapsePanel open={open || exportMode}>
			<div className="min-w-0 pb-1 pl-6">{children}</div>
		</CollapsePanel>
	);
}

export const ProgressGroup = {
	Root: ProgressGroupRoot,
	Frame: ProgressGroupFrame,
	Trigger: ProgressGroupTrigger,
	Status: ProgressGroupStatus,
	Title: ProgressGroupTitle,
	Chevron: ProgressGroupChevron,
	Content: ProgressGroupContent,
	RowRoot: ProgressGroupRowRoot,
	RowFrame: ProgressGroupRowFrame,
	RowTrigger: ProgressGroupRowTrigger,
	RowStatus: ProgressGroupRowStatus,
	RowText: ProgressGroupRowText,
	RowChevron: ProgressGroupRowChevron,
	RowContent: ProgressGroupRowContent,
} as const;
