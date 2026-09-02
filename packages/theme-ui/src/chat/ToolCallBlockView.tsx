import { Slot } from "radix-ui";
import {
	createContext,
	forwardRef,
	type ButtonHTMLAttributes,
	type ComponentPropsWithoutRef,
	type ReactNode,
	useContext,
} from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

const ROW_BUTTON =
	"inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors";
const GUTTER = "ml-4 min-w-0 border-l border-border/50 pl-3 pt-1 pb-2";

interface ToolCallContextValue {
	readonly canExpand: boolean;
	readonly expanded: boolean;
	readonly exportMode: boolean;
	readonly panelId?: string;
	readonly onToggle: () => void;
}

const ToolCallContext = createContext<ToolCallContextValue | null>(null);

export interface ToolCallRootProps extends ToolCallContextValue {
	readonly children: ReactNode;
}

export function ToolCallRoot({ children, ...value }: ToolCallRootProps): JSX.Element {
	return <ToolCallContext.Provider value={value}>{children}</ToolCallContext.Provider>;
}

function useToolCallContext(part: string): ToolCallContextValue {
	const context = useContext(ToolCallContext);
	if (!context) throw new Error(`${part} must be used within ToolCall.Root`);
	return context;
}

export interface ToolCallPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

function createPrimitive(displayName: string, baseClassName: string) {
	const Primitive = forwardRef<HTMLDivElement, ToolCallPrimitiveProps>(function Primitive(
		{ asChild = false, className, ...props },
		forwardedRef,
	) {
		const Comp = asChild ? Slot.Root : "div";
		return (
			<Comp
				ref={forwardedRef}
				className={`${baseClassName}${className ? ` ${className}` : ""}`}
				{...props}
			/>
		);
	});
	Primitive.displayName = displayName;
	return Primitive;
}

interface ToolCallTextPrimitiveProps extends ComponentPropsWithoutRef<"span"> {
	readonly asChild?: boolean;
}

function createTextPrimitive(displayName: string, baseClassName: string) {
	const Primitive = forwardRef<HTMLSpanElement, ToolCallTextPrimitiveProps>(function Primitive(
		{ asChild = false, className, ...props },
		forwardedRef,
	) {
		const Comp = asChild ? Slot.Root : "span";
		return (
			<Comp
				ref={forwardedRef}
				className={`${baseClassName}${className ? ` ${className}` : ""}`}
				{...props}
			/>
		);
	});
	Primitive.displayName = displayName;
	return Primitive;
}

export const ToolCallFrame = createPrimitive("ToolCall.Frame", "min-w-0 w-full");
export const ToolCallEmbedded = createPrimitive("ToolCall.Embedded", "min-w-0 w-full py-0.5");

export interface ToolCallTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	readonly asChild?: boolean;
}

export const ToolCallTrigger = forwardRef<HTMLButtonElement, ToolCallTriggerProps>(
	function ToolCallTrigger({ asChild = false, className, onClick, type, ...props }, forwardedRef) {
		const { canExpand, expanded, onToggle, panelId } = useToolCallContext("ToolCall.Trigger");
		const Comp = asChild ? Slot.Root : "button";
		return (
			<Comp
				ref={forwardedRef}
				type={asChild ? undefined : (type ?? "button")}
				onClick={(event) => {
					onClick?.(event);
					if (!event.defaultPrevented && canExpand) onToggle();
				}}
				data-export-toggle={canExpand ? panelId : undefined}
				aria-expanded={expanded}
				className={`${ROW_BUTTON} ${
					canExpand ? "cursor-pointer hover:bg-muted/60" : "cursor-default"
				}${className ? ` ${className}` : ""}`}
				{...props}
			/>
		);
	},
);

export function ToolCallStatusIcon({
	icon,
	iconColorClass,
	pending,
}: {
	readonly icon: string;
	readonly iconColorClass: string;
	readonly pending: boolean;
}): JSX.Element {
	return pending ? (
		<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/50" />
	) : (
		<span className={`${icon} h-3.5 w-3.5 shrink-0 ${iconColorClass}`} />
	);
}

export const ToolCallServer = createTextPrimitive(
	"ToolCall.Server",
	"shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground/50",
);
export const ToolCallName = createTextPrimitive(
	"ToolCall.Name",
	"shrink-0 text-[12px] font-medium text-foreground/80",
);
export const ToolCallDetail = createTextPrimitive(
	"ToolCall.Detail",
	"min-w-0 truncate text-[12px] text-muted-foreground/70",
);
export const ToolCallPhase = createTextPrimitive(
	"ToolCall.Phase",
	"tool-call-shimmer-text min-w-0 truncate text-[12px] text-muted-foreground/60",
);
export const ToolCallBadge = createTextPrimitive(
	"ToolCall.Badge",
	"shrink-0 text-[11px] tabular-nums text-muted-foreground/50",
);

export function ToolCallChevron(): JSX.Element | null {
	const { canExpand, expanded } = useToolCallContext("ToolCall.Chevron");
	if (!canExpand) return null;
	return (
		<span
			className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
		/>
	);
}

export function ToolCallContent({ children }: { readonly children: ReactNode }): JSX.Element {
	const { canExpand, expanded, exportMode, panelId } = useToolCallContext("ToolCall.Content");
	return (
		<CollapsePanel
			open={(expanded || exportMode) && canExpand}
			id={panelId}
			exportPanel={exportMode}
			hidden={exportMode && !expanded}
		>
			<div className={GUTTER}>{children}</div>
		</CollapsePanel>
	);
}

export const ToolCall = {
	Root: ToolCallRoot,
	Frame: ToolCallFrame,
	Embedded: ToolCallEmbedded,
	Trigger: ToolCallTrigger,
	StatusIcon: ToolCallStatusIcon,
	Server: ToolCallServer,
	Name: ToolCallName,
	Detail: ToolCallDetail,
	Phase: ToolCallPhase,
	Badge: ToolCallBadge,
	Chevron: ToolCallChevron,
	Content: ToolCallContent,
} as const;
