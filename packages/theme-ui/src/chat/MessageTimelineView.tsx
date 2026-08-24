import { cn } from "@vetta/ui";
import { forwardRef, type ButtonHTMLAttributes, type JSX, type ReactNode } from "react";

export interface MessageTimelineTickView {
	active: boolean;
	id: string;
	label: string;
	name: string;
	onClick: () => void;
}

export interface MessageTimelineTriggerViewProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	label: string;
}

export const MessageTimelineTriggerView = forwardRef<
	HTMLButtonElement,
	MessageTimelineTriggerViewProps
>(function MessageTimelineTriggerView({ className, label, ...buttonProps }, ref) {
	return (
		<button
			{...buttonProps}
			ref={ref}
			type="button"
			aria-label={label}
			title={label}
			className={cn(
				// 刻度靠 pl-1 贴左，图标比刻度宽，-ml-1 把它拉回同一条视觉左缘。
				"-ml-[2px] flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors",
				"hover:bg-accent/60 hover:text-foreground",
				"focus-visible:bg-accent/60 focus-visible:outline-none",
				"data-[state=open]:bg-accent data-[state=open]:text-foreground",
				className,
			)}
		>
			<span className="icon-[solar--inbox-archive-outline] h-3 w-3" aria-hidden />
		</button>
	);
});

const TICK_STEP_PX = 8;
const TICK_PAD_PX = 4;
const MAX_RAIL_HEIGHT_PX = 200;

export function MessageTimelineView({
	label,
	open,
	panel,
	rail,
	trigger,
}: {
	label: string;
	open: boolean;
	panel: ReactNode;
	rail: ReactNode;
	trigger: ReactNode;
}): JSX.Element {
	return (
		<div className="relative">
			<nav
				aria-label={label}
				aria-expanded={open}
				className={cn(
					"flex w-5 flex-col items-start gap-1 transition-opacity",
					open ? "opacity-100" : "opacity-60 hover:opacity-100",
				)}
			>
				{trigger}
				{rail}
			</nav>
			{panel ? (
				<div className="absolute top-1/2 left-full z-30 ml-1.5 -translate-y-1/2">{panel}</div>
			) : null}
		</div>
	);
}

export function MessageTimelineRailView({
	showPreview = true,
	ticks,
}: {
	showPreview?: boolean;
	ticks: readonly MessageTimelineTickView[];
}): JSX.Element {
	const last = Math.max(1, ticks.length - 1);
	const innerHeight = Math.min(last * TICK_STEP_PX, MAX_RAIL_HEIGHT_PX);
	return (
		<div className="relative w-full" style={{ height: innerHeight + TICK_PAD_PX * 2 }}>
			{ticks.map((tick, index) => (
				<button
					key={tick.id}
					type="button"
					aria-label={tick.name}
					aria-current={tick.active ? "location" : undefined}
					onClick={tick.onClick}
					// 刻度左缘对齐（pl-1 让刻度贴住轨道左侧），加宽只向右延伸，不左右一起撑开。
					className="group absolute left-1/2 z-0 flex h-3 w-full -translate-x-1/2 -translate-y-1/2 items-center justify-start pl-1 hover:z-20 focus-visible:z-20"
					style={{ top: TICK_PAD_PX + (index / last) * innerHeight }}
				>
					<span
						className={cn(
							// 刻度只有 2px 高，悬停时靠加宽给出比变色更明确的命中反馈。
							"h-0.5 rounded-full transition-[width,background-color] duration-150",
							tick.active
								? "w-3 bg-primary group-hover:w-7 group-focus-visible:w-7"
								: "w-2 bg-muted-foreground/50 group-hover:w-6 group-hover:bg-muted-foreground/80 group-focus-visible:w-6 group-focus-visible:bg-muted-foreground/80",
						)}
						aria-hidden
					/>
					{showPreview ? (
						<span
							aria-hidden
							className={cn(
								"pointer-events-none absolute left-full z-30 ml-2 w-max max-w-64",
								"rounded-lg border border-border/50 bg-popover px-2.5 py-1.5 shadow-md",
								"text-left text-[12px] leading-snug text-popover-foreground",
								"line-clamp-3 break-words whitespace-normal",
								"opacity-0 delay-0 duration-150 transition-opacity",
								"group-hover:opacity-100 group-hover:delay-150",
								"group-focus-visible:opacity-100 group-focus-visible:delay-0",
							)}
						>
							{tick.label}
						</span>
					) : null}
				</button>
			))}
		</div>
	);
}

export function MessageTimelinePanelView({
	closeLabel,
	countLabel,
	emptyLabel,
	searchInput,
	timeline,
	title,
	onClose,
}: {
	closeLabel: string;
	countLabel: string;
	emptyLabel: string;
	searchInput: ReactNode;
	timeline: ReactNode;
	title: string;
	onClose: () => void;
}): JSX.Element {
	return (
		<div className="flex h-72 w-64 flex-col overflow-hidden rounded-xl border border-border/50 bg-popover shadow-md">
			<div className="px-3 pt-2.5 pb-2">
				<div className="mb-2 flex items-center gap-2">
					<h2 className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80">{title}</h2>
					<span className="text-[11px] text-muted-foreground/50">{countLabel}</span>
					<button
						type="button"
						aria-label={closeLabel}
						title={closeLabel}
						onClick={onClose}
						className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/60 hover:text-foreground"
					>
						<span className="icon-[solar--close-circle-linear] h-3.5 w-3.5" aria-hidden />
					</button>
				</div>
				{searchInput}
			</div>
			<div className="min-h-0 flex-1 px-1 pb-1">
				{timeline || <div className="px-2 py-2 text-[12px] text-muted-foreground">{emptyLabel}</div>}
			</div>
		</div>
	);
}

export function MessageTimelineEntryView({
	active,
	matchPreview,
	preview,
	onClick,
}: {
	active: boolean;
	matchPreview?: string | null;
	preview: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? "location" : undefined}
			className={cn(
				"flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
				"hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none",
				active ? "bg-primary/15 text-foreground" : "text-foreground/80",
			)}
		>
			<span className="block w-full truncate text-[12px]">{preview}</span>
			{matchPreview ? (
				<span className="block w-full truncate text-[11px] text-muted-foreground/50">{matchPreview}</span>
			) : null}
		</button>
	);
}
