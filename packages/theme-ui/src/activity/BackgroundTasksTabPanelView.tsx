import { Button } from "@vetta/ui";
import type { JSX, ReactNode } from "react";
import { useEffect, useRef } from "react";

export type BackgroundTaskStatus = "running" | "completed" | "failed" | "killed";

export type SubagentWorkStatus = "queued" | "pending" | "running" | "completed" | "failed" | "interrupted";
export type McpTaskWorkStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";

/** Bash background task row (run_in_background). */
export interface BackgroundTaskViewItem {
	kind?: "bash";
	id: string;
	command: string;
	status: BackgroundTaskStatus;
	tail: string;
	exitCode?: number;
	statusIcon: string;
	statusLabel: string;
	statusClassName: string;
	durationLabel: string;
}

/** Subagent child row (explorer / future types) — same tab, different card. */
export interface SubagentWorkViewItem {
	kind: "subagent";
	id: string;
	agentType: string;
	taskName: string;
	path: string;
	status: SubagentWorkStatus;
	taskPreview: string;
	finalText?: string;
	errorLabel?: string;
	errorDetail?: string;
	progressLabel?: string;
	usageLabel: string;
	statusIcon: string;
	statusLabel: string;
	statusClassName: string;
	durationLabel: string;
}

/** MCP 2026 Tasks extension row. It is not a local process or subagent. */
export interface McpTaskWorkViewItem {
	kind: "mcp";
	id: string;
	serverName: string;
	toolName: string;
	status: McpTaskWorkStatus;
	statusMessage?: string;
	statusIcon: string;
	statusLabel: string;
	statusClassName: string;
	durationLabel: string;
}

export type BackgroundWorkViewItem = BackgroundTaskViewItem | SubagentWorkViewItem | McpTaskWorkViewItem;

export interface BackgroundTasksTabPanelViewProps {
	items: readonly BackgroundWorkViewItem[];
	emptyLabel: string;
	/** Null when there are no finished bash tasks (hide clear button). */
	clearFinishedLabel: string | null;
	onClearFinished: () => void;
	/** Label for the per-task stop button (running tasks only). */
	stopLabel: string;
	/** Bash: task id; Subagent: child id / path. */
	onStop: (id: string, kind: "bash" | "subagent" | "mcp") => void;
}

/**
 * Shared card shell: a bordered surface so rows stay separable on a wide panel,
 * plus a status-tinted left rail that carries the state without extra chrome.
 */
function WorkCard({ active, children }: { active: boolean; children: ReactNode }): JSX.Element {
	return (
		<div
			className={`relative min-w-0 overflow-hidden rounded-xl border bg-card/50 pl-3.5 pr-3 py-2.5 transition-colors duration-200 hover:bg-card ${
				active ? "border-primary/25 hover:border-primary/40" : "border-border/50 hover:border-border"
			}`}
		>
			<span
				aria-hidden
				className={`absolute inset-y-0 left-0 w-[3px] ${active ? "bg-primary/50" : "bg-border/60"}`}
			/>
			{children}
		</div>
	);
}

/** Header row: kind badge + identity on the left, status meta + stop pinned right. */
function WorkCardHeader({
	statusIcon,
	statusClassName,
	statusLabel,
	durationLabel,
	badge,
	identity,
	extraMeta,
	action,
}: {
	statusIcon: string;
	statusClassName: string;
	statusLabel: string;
	durationLabel: string;
	badge: ReactNode;
	identity: ReactNode;
	extraMeta?: ReactNode;
	action?: ReactNode;
}): JSX.Element {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<span className={`${statusIcon} h-3.5 w-3.5 shrink-0 ${statusClassName}`} />
			{badge}
			<div className="min-w-0 flex-1">{identity}</div>
			<div className="flex shrink-0 items-center gap-2 pl-2">
				<span className={`whitespace-nowrap text-[11px] font-medium ${statusClassName}`}>{statusLabel}</span>
				{extraMeta}
				<span className="whitespace-nowrap font-mono text-[10px] tabular-nums text-muted-foreground/60">
					{durationLabel}
				</span>
				{action}
			</div>
		</div>
	);
}

function KindBadge({ tone, children }: { tone: "neutral" | "primary"; children: ReactNode }): JSX.Element {
	return (
		<span
			className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
				tone === "primary" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
			}`}
		>
			{children}
		</span>
	);
}

function StopButton({
	label,
	iconOnly,
	onClick,
}: {
	label: string;
	iconOnly: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<Button
			type="button"
			variant="ghost"
			size={iconOnly ? "icon-xs" : "xs"}
			onClick={onClick}
			title={label}
			aria-label={label}
			className={`shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive ${
				iconOnly ? "h-6 w-6" : "h-6 px-1.5 text-[10px]"
			}`}
		>
			<span className={`icon-[solar--stop-circle-linear] ${iconOnly ? "h-3.5 w-3.5" : "h-3 w-3"}`} />
			{!iconOnly && <span>{label}</span>}
		</Button>
	);
}

/** Terminal-like block that keeps the command and its output visually joined. */
function OutputBlock({ children, mono = true }: { children: ReactNode; mono?: boolean }): JSX.Element {
	return (
		<div
			className={`mt-2 max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground ${
				mono ? "font-mono" : ""
			}`}
		>
			{children}
		</div>
	);
}

function BashTaskCard({
	task,
	stopLabel,
	onStop,
}: {
	task: BackgroundTaskViewItem;
	stopLabel: string;
	onStop: (taskId: string) => void;
}): JSX.Element {
	const tailRef = useRef<HTMLPreElement>(null);

	useEffect(() => {
		const el = tailRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [task.tail]);

	const running = task.status === "running";

	return (
		<WorkCard active={running}>
			<WorkCardHeader
				statusIcon={task.statusIcon}
				statusClassName={task.statusClassName}
				statusLabel={task.statusLabel}
				durationLabel={task.durationLabel}
				badge={<KindBadge tone="neutral">bash</KindBadge>}
				identity={
					<span className="block truncate font-mono text-[10px] text-muted-foreground/70" title={task.id}>
						{task.id}
					</span>
				}
				extraMeta={
					task.exitCode !== undefined ? (
						<span className="whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
							exit {task.exitCode}
						</span>
					) : undefined
				}
				action={running ? <StopButton label={stopLabel} iconOnly={false} onClick={() => onStop(task.id)} /> : undefined}
			/>
			<div className="mt-2 flex min-w-0 items-start gap-1.5 rounded-lg bg-muted/40 px-2 py-1.5">
				<span aria-hidden className="shrink-0 select-none font-mono text-[11px] text-muted-foreground/50">
					$
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={task.command}>
					{task.command}
				</span>
			</div>
			{task.tail && (
				<pre
					ref={tailRef}
					className="mt-1 max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/40 bg-background/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground"
				>
					{task.tail}
				</pre>
			)}
		</WorkCard>
	);
}

function SubagentCard({
	item,
	stopLabel,
	onStop,
}: {
	item: SubagentWorkViewItem;
	stopLabel: string;
	onStop: (id: string) => void;
}): JSX.Element {
	const active = item.status === "queued" || item.status === "pending" || item.status === "running";
	return (
		<WorkCard active={active}>
			<WorkCardHeader
				statusIcon={item.statusIcon}
				statusClassName={item.statusClassName}
				statusLabel={item.statusLabel}
				durationLabel={item.durationLabel}
				badge={<KindBadge tone="primary">{item.agentType}</KindBadge>}
				identity={
					<span className="block truncate font-mono text-[10px] text-muted-foreground/70" title={item.taskName}>
						{item.taskName}
					</span>
				}
				action={active ? <StopButton label={stopLabel} iconOnly onClick={() => onStop(item.id)} /> : undefined}
			/>
			<div className="mt-2 min-w-0 line-clamp-2 text-[11px] leading-relaxed text-foreground" title={item.taskPreview}>
				{item.taskPreview}
			</div>
			{(item.progressLabel || item.usageLabel) && (
				<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] tabular-nums text-muted-foreground/70">
					{item.progressLabel && <span>{item.progressLabel}</span>}
					{item.progressLabel && item.usageLabel && <span aria-hidden className="text-border">·</span>}
					{item.usageLabel && <span>{item.usageLabel}</span>}
				</div>
			)}
			{item.errorLabel && (
				<div className="mt-2 min-w-0 rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-[10px] text-destructive">
					<div className="font-medium">{item.errorLabel}</div>
					{item.errorDetail && <div className="mt-0.5 max-h-16 overflow-auto break-words">{item.errorDetail}</div>}
				</div>
			)}
			{item.finalText && <OutputBlock>{item.finalText}</OutputBlock>}
		</WorkCard>
	);
}

function McpTaskCard({
	item,
	stopLabel,
	onStop,
}: {
	item: McpTaskWorkViewItem;
	stopLabel: string;
	onStop: (id: string) => void;
}): JSX.Element {
	const active = item.status === "working" || item.status === "input_required";
	return (
		<WorkCard active={active}>
			<WorkCardHeader
				statusIcon={item.statusIcon}
				statusClassName={item.statusClassName}
				statusLabel={item.statusLabel}
				durationLabel={item.durationLabel}
				badge={<KindBadge tone="primary">MCP</KindBadge>}
				identity={
					<span className="block truncate text-[11px] text-foreground" title={`${item.serverName}: ${item.toolName}`}>
						{item.serverName}: {item.toolName}
					</span>
				}
				action={active ? <StopButton label={stopLabel} iconOnly onClick={() => onStop(item.id)} /> : undefined}
			/>
			{item.statusMessage && (
				<div className="mt-1.5 line-clamp-3 break-words text-[11px] leading-relaxed text-muted-foreground">
					{item.statusMessage}
				</div>
			)}
		</WorkCard>
	);
}

export function BackgroundTasksTabPanelView({
	items,
	emptyLabel,
	clearFinishedLabel,
	onClearFinished,
	stopLabel,
	onStop,
}: BackgroundTasksTabPanelViewProps): JSX.Element {
	if (items.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-[12px] text-muted-foreground">
				<span className="icon-[solar--server-square-cloud-linear] h-8 w-8 text-muted-foreground/40" />
				<span>{emptyLabel}</span>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			{clearFinishedLabel !== null && (
				<div className="flex shrink-0 items-center justify-end border-b border-border/40 px-2.5 py-1.5">
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={onClearFinished}
						className="h-6 max-w-full rounded-lg px-1.5 text-[11px] text-muted-foreground"
					>
						<span className="icon-[solar--trash-bin-minimalistic-linear] h-3 w-3 shrink-0" />
						<span className="truncate">{clearFinishedLabel}</span>
					</Button>
				</div>
			)}
			<div className="min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-2.5">
				{items.map((item) =>
					item.kind === "subagent" ? (
						<SubagentCard
							key={`subagent:${item.id}`}
							item={item}
							stopLabel={stopLabel}
							onStop={(id) => onStop(id, "subagent")}
						/>
					) : item.kind === "mcp" ? (
						<McpTaskCard
							key={`mcp:${item.id}`}
							item={item}
							stopLabel={stopLabel}
							onStop={(id) => onStop(id, "mcp")}
						/>
					) : (
						<BashTaskCard
							key={`bash:${item.id}`}
							task={item}
							stopLabel={stopLabel}
							onStop={(id) => onStop(id, "bash")}
						/>
					),
				)}
			</div>
		</div>
	);
}
