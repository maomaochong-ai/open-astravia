import { Slot } from "radix-ui";
import {
	createContext,
	forwardRef,
	type ButtonHTMLAttributes,
	type ComponentPropsWithoutRef,
	type ReactNode,
	useContext,
	useId,
	useMemo,
	useState,
} from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

interface ThinkingBlockContextValue {
	readonly expanded: boolean;
	readonly exportMode: boolean;
	readonly panelId?: string;
	readonly toggle: () => void;
}

const ThinkingBlockContext = createContext<ThinkingBlockContextValue | null>(null);

export interface ThinkingBlockRootProps {
	readonly children: ReactNode;
	readonly exportMode?: boolean;
	readonly expanded?: boolean;
	readonly onExpandedChange?: (expanded: boolean) => void;
}

export function ThinkingBlockRoot({
	children,
	exportMode = false,
	expanded: controlledExpanded,
	onExpandedChange,
}: ThinkingBlockRootProps): JSX.Element {
	const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
	const expanded = controlledExpanded ?? uncontrolledExpanded;
	const generatedId = useId();
	const panelId = exportMode ? `export-thinking-${generatedId}` : undefined;
	const value = useMemo(
		() => ({
			expanded,
			exportMode,
			panelId,
			toggle: () => {
				const nextExpanded = !expanded;
				if (controlledExpanded === undefined) setUncontrolledExpanded(nextExpanded);
				onExpandedChange?.(nextExpanded);
			},
		}),
		[controlledExpanded, expanded, exportMode, onExpandedChange, panelId],
	);
	return <ThinkingBlockContext.Provider value={value}>{children}</ThinkingBlockContext.Provider>;
}

function useThinkingBlockContext(part: string): ThinkingBlockContextValue {
	const context = useContext(ThinkingBlockContext);
	if (!context) throw new Error(`${part} must be used within ThinkingBlock.Root`);
	return context;
}

export interface ThinkingBlockPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

function createPrimitive(displayName: string, baseClassName: string) {
	const Primitive = forwardRef<HTMLDivElement, ThinkingBlockPrimitiveProps>(function Primitive(
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

interface ThinkingBlockTextPrimitiveProps extends ComponentPropsWithoutRef<"span"> {
	readonly asChild?: boolean;
}

function createTextPrimitive(displayName: string, baseClassName: string) {
	const Primitive = forwardRef<HTMLSpanElement, ThinkingBlockTextPrimitiveProps>(function Primitive(
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

export const ThinkingBlockFrame = createPrimitive("ThinkingBlock.Frame", "min-w-0 w-full");

export interface ThinkingBlockTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	readonly asChild?: boolean;
}

export const ThinkingBlockTrigger = forwardRef<HTMLButtonElement, ThinkingBlockTriggerProps>(
	function ThinkingBlockTrigger({ asChild = false, className, onClick, type, ...props }, forwardedRef) {
		const { expanded, panelId, toggle } = useThinkingBlockContext("ThinkingBlock.Trigger");
		const Comp = asChild ? Slot.Root : "button";
		return (
			<Comp
				ref={forwardedRef}
				type={asChild ? undefined : (type ?? "button")}
				onClick={(event) => {
					onClick?.(event);
					if (!event.defaultPrevented) toggle();
				}}
				data-export-toggle={panelId}
				aria-expanded={expanded}
				className={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/60${className ? ` ${className}` : ""}`}
				{...props}
			/>
		);
	},
);

export function ThinkingBlockIcon(): JSX.Element {
	return <span className="icon-[solar--lightbulb-bolt-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />;
}

export const ThinkingBlockTitle = createTextPrimitive(
	"ThinkingBlock.Title",
	"min-w-0 truncate text-[12px] text-muted-foreground/70",
);
export const ThinkingBlockLineCount = createTextPrimitive(
	"ThinkingBlock.LineCount",
	"shrink-0 text-[11px] text-muted-foreground/40",
);

export function ThinkingBlockChevron(): JSX.Element {
	const { expanded } = useThinkingBlockContext("ThinkingBlock.Chevron");
	return (
		<span
			className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
		/>
	);
}

export function ThinkingBlockContent({ children }: { readonly children: ReactNode }): JSX.Element {
	const { expanded, exportMode, panelId } = useThinkingBlockContext("ThinkingBlock.Content");
	return (
		<CollapsePanel
			open={expanded || exportMode}
			id={panelId}
			exportPanel={exportMode}
			hidden={exportMode && !expanded}
		>
			<div className="ml-4 border-l border-border/50 pl-3 pt-1 pb-2">
				<div className="whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-muted-foreground/70">
					{children}
				</div>
			</div>
		</CollapsePanel>
	);
}

export const ThinkingBlock = {
	Root: ThinkingBlockRoot,
	Frame: ThinkingBlockFrame,
	Trigger: ThinkingBlockTrigger,
	Icon: ThinkingBlockIcon,
	Title: ThinkingBlockTitle,
	LineCount: ThinkingBlockLineCount,
	Chevron: ThinkingBlockChevron,
	Content: ThinkingBlockContent,
} as const;
