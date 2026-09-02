import { Slot } from "radix-ui";
import {
	createContext,
	forwardRef,
	type ComponentPropsWithoutRef,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
} from "react";

export type BashTerminalStatus = "pending" | "success" | "error";

export interface BashTerminalLabels {
	readonly metaDescription: string;
	readonly executing: string;
	readonly meta: string;
}

interface BashTerminalContextValue {
	readonly command: string;
	readonly result?: string;
	readonly status: BashTerminalStatus;
	readonly isError?: boolean;
	readonly startedAt?: number;
	readonly durationMs?: number;
	readonly startedAtLabel?: string;
	readonly durationLabel?: string;
	readonly phasesLabel?: string;
	readonly headerLabel: string;
	readonly labels: BashTerminalLabels;
}

const BashTerminalContext = createContext<BashTerminalContextValue | null>(null);

export interface BashTerminalRootProps extends BashTerminalContextValue {
	readonly children: ReactNode;
}

export function BashTerminalRoot({ children, ...value }: BashTerminalRootProps): JSX.Element {
	return <BashTerminalContext.Provider value={value}>{children}</BashTerminalContext.Provider>;
}

function useBashTerminalContext(part: string): BashTerminalContextValue {
	const context = useContext(BashTerminalContext);
	if (!context) throw new Error(`${part} must be used within BashTerminal.Root`);
	return context;
}

export interface BashTerminalPrimitiveProps extends ComponentPropsWithoutRef<"div"> {
	readonly asChild?: boolean;
}

function createPrimitive(displayName: string, baseClassName: string) {
	const Primitive = forwardRef<HTMLDivElement, BashTerminalPrimitiveProps>(function Primitive(
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

export const BashTerminalCard = createPrimitive(
	"BashTerminal.Card",
	"group/term min-w-0 max-w-full overflow-hidden rounded-lg border border-muted-foreground/15 bg-muted/30",
);
export const BashTerminalHeader = createPrimitive(
	"BashTerminal.Header",
	"flex items-center gap-2 border-b border-muted-foreground/10 bg-muted/20 px-3 py-1.5",
);
export const BashTerminalCopyAction = createPrimitive(
	"BashTerminal.CopyAction",
	"opacity-0 transition-opacity group-hover/term:opacity-100",
);

export function BashTerminalStatusDot(): JSX.Element {
	const { isError, status } = useBashTerminalContext("BashTerminal.StatusDot");
	const pending = status === "pending";
	const failed = status === "error" || isError === true;
	return (
		<span
			className={`h-1.5 w-1.5 shrink-0 rounded-full ${
				failed ? "bg-destructive/70" : pending ? "bg-primary/60" : "bg-muted-foreground/40"
			}`}
			style={pending ? { animation: "pulse 1.5s infinite" } : undefined}
		/>
	);
}

export function BashTerminalHeaderLabel(): JSX.Element {
	const { headerLabel } = useBashTerminalContext("BashTerminal.HeaderLabel");
	return <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">{headerLabel}</span>;
}

export function BashTerminalCommand(): JSX.Element {
	const { command, status } = useBashTerminalContext("BashTerminal.Command");
	const pending = status === "pending";
	return (
		<div className="max-h-[180px] overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55]">
			<div className="flex min-w-0">
				<span className="shrink-0 select-none pr-2 text-amber-500 dark:text-amber-400">$</span>
				<pre className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/85">
					{command}
					{pending ? (
						<span
							className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[2px] bg-foreground/70 align-baseline"
							style={{ animation: "bash-cursor-blink 1s steps(1) infinite" }}
						/>
					) : null}
				</pre>
			</div>
		</div>
	);
}

export function BashTerminalResult(): JSX.Element | null {
	const { result, status } = useBashTerminalContext("BashTerminal.Result");
	if (status === "pending" || !result) return null;
	return (
		<div className="max-h-[300px] overflow-auto border-t border-muted-foreground/10 px-3 py-2 font-mono text-[12px] leading-[1.55]">
			<pre className="m-0 min-w-0 whitespace-pre-wrap break-words text-foreground/75">{result}</pre>
		</div>
	);
}

export function BashTerminalPendingStatus(): JSX.Element | null {
	const { labels, status } = useBashTerminalContext("BashTerminal.PendingStatus");
	if (status !== "pending") return null;
	return (
		<div className="flex items-center gap-1.5 border-t border-muted-foreground/10 px-3 py-1.5 text-[10px] italic text-muted-foreground/55">
			<span className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" />
			<span className="tool-call-shimmer-text">{labels.executing}</span>
		</div>
	);
}

export function BashTerminalMeta(): JSX.Element | null {
	const {
		durationLabel,
		durationMs,
		labels,
		phasesLabel,
		startedAt,
		startedAtLabel,
		status,
	} = useBashTerminalContext("BashTerminal.Meta");
	if (status === "pending" || startedAt === undefined) return null;
	return (
		<div
			className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-muted-foreground/10 px-3 py-1.5 text-[10px] text-muted-foreground/50"
			title={labels.metaDescription}
		>
			<span className="font-medium text-muted-foreground/60">{labels.meta}</span>
			<span className="tabular-nums">{startedAtLabel}</span>
			{durationMs !== undefined && durationLabel ? (
				<>
					<span className="text-muted-foreground/30">·</span>
					<span className="tabular-nums">{durationLabel}</span>
				</>
			) : null}
			{phasesLabel ? (
				<>
					<span className="text-muted-foreground/30">·</span>
					<span className="break-all">{phasesLabel}</span>
				</>
			) : null}
		</div>
	);
}

export function BashTerminalBackgroundTaskTail({
	children,
	taskId,
	status,
	tail,
}: {
	readonly children: ReactNode;
	readonly taskId: string;
	readonly status: string;
	readonly tail?: string;
}): JSX.Element {
	const tailRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = tailRef.current;
		if (element) element.scrollTop = element.scrollHeight;
	}, [tail, taskId, status]);
	return (
		<>
			{tail ? (
				<div
					ref={tailRef}
					className="max-h-[180px] overflow-auto border-t border-muted-foreground/10 px-3 py-2 font-mono text-[12px] leading-[1.55]"
				>
					<pre className="m-0 min-w-0 whitespace-pre-wrap break-words text-foreground/75">{tail}</pre>
				</div>
			) : null}
			<div className="flex items-center gap-1.5 border-t border-muted-foreground/10 px-3 py-1.5 text-[10px] italic text-muted-foreground/55">
				{children}
			</div>
		</>
	);
}

export const BashTerminal = {
	Root: BashTerminalRoot,
	Card: BashTerminalCard,
	Header: BashTerminalHeader,
	StatusDot: BashTerminalStatusDot,
	HeaderLabel: BashTerminalHeaderLabel,
	CopyAction: BashTerminalCopyAction,
	Command: BashTerminalCommand,
	Result: BashTerminalResult,
	PendingStatus: BashTerminalPendingStatus,
	Meta: BashTerminalMeta,
	BackgroundTaskTail: BashTerminalBackgroundTaskTail,
} as const;
