import { Button } from "@vetta/ui";
import type { JSX } from "react";
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
		<div className="min-w-0 overflow-hidden rounded-xl bg-muted/30 px-3 py-2.5 transition-colors duration-200 hover:bg-muted/50">
			{/* Left: badges (name truncates). Right: status/duration/stop never wrap or shrink. */}
			<div className="flex min-w-0 items-center gap-1.5">
				<span className={`${task.statusIcon} h-3.5 w-3.5 shrink-0 ${task.statusClassName}`} />
				<span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">bash</span>
				<span
					className="min-w-0 flex-1 truncate rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
					title={task.id}
				>
					{task.id}
				</span>
				<span className={`shrink-0 whitespace-nowrap text-[11px] font-medium ${task.statusClassName}`}>
					{task.statusLabel}
				</span>
				{task.exitCode !== undefined && (
					<span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/70">
						exit {task.exitCode}
					</span>
				)}
				<span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/70">
					{task.durationLabel}
				</span>
				{running && (
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={() => onStop(task.id)}
						title={stopLabel}
						aria-label={stopLabel}
						className="h-6 shrink-0 rounded-lg px-1.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
					>
						<span className="icon-[solar--stop-circle-linear] h-3 w-3" />
						<span>{stopLabel}</span>
					</Button>
				)}
			</div>
			<div className="mt-1.5 min-w-0 truncate font-mono text-[11px] text-foreground" title={task.command}>
				{task.command}
			</div>
			{task.tail && (
				<pre
					ref={tailRef}
					className="mt-1.5 max-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground"
				>
					{task.tail}
				</pre>
			)}
		</div>
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
		<div className="min-w-0 overflow-hidden rounded-xl bg-muted/30 px-3 py-2.5 transition-colors duration-200 hover:bg-muted/50">
			{/* taskName is the only flexible chip; status/duration/stop stay on one line. */}
			<div className="flex min-w-0 items-center gap-1.5">
				<span className={`${item.statusIcon} h-3.5 w-3.5 shrink-0 ${item.statusClassName}`} />
				<span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
					{item.agentType}
				</span>
				<span
					className="min-w-0 flex-1 truncate rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
					title={item.taskName}
				>
					{item.taskName}
				</span>
				<span className={`shrink-0 whitespace-nowrap text-[11px] font-medium ${item.statusClassName}`}>
					{item.statusLabel}
				</span>
				<span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/70">
					{item.durationLabel}
				</span>
				{active && (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={() => onStop(item.id)}
						title={stopLabel}
						aria-label={stopLabel}
						className="h-6 w-6 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
					>
						<span className="icon-[solar--stop-circle-linear] h-3.5 w-3.5" />
					</Button>
				)}
			</div>
			<div className="mt-1.5 min-w-0 line-clamp-2 text-[11px] leading-relaxed text-foreground" title={item.taskPreview}>
				{item.taskPreview}
			</div>
			{(item.progressLabel || item.usageLabel) && (
				<div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
					{item.progressLabel && <span>{item.progressLabel}</span>}
					{item.usageLabel && <span>{item.usageLabel}</span>}
				</div>
			)}
			{item.errorLabel && (
				<div className="mt-2 min-w-0 rounded-lg bg-destructive/10 px-2.5 py-2 text-[10px] text-destructive">
					<div className="font-medium">{item.errorLabel}</div>
					{item.errorDetail && <div className="mt-0.5 max-h-16 overflow-auto break-words">{item.errorDetail}</div>}
				</div>
			)}
			{item.finalText && (
				<pre className="mt-1.5 max-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
					{item.finalText}
				</pre>
			)}
		</div>
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
		<div className="min-w-0 overflow-hidden rounded-xl bg-muted/30 px-3 py-2.5 transition-colors duration-200 hover:bg-muted/50">
			<div className="flex min-w-0 items-center gap-1.5">
				<span className={`${item.statusIcon} h-3.5 w-3.5 shrink-0 ${item.statusClassName}`} />
				<span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
					MCP
				</span>
				<span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={`${item.serverName}: ${item.toolName}`}>
					{item.serverName}: {item.toolName}
				</span>
				<span className={`shrink-0 whitespace-nowrap text-[11px] font-medium ${item.statusClassName}`}>
					{item.statusLabel}
				</span>
				<span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground/70">
					{item.durationLabel}
				</span>
				{active && (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={() => onStop(item.id)}
						title={stopLabel}
						aria-label={stopLabel}
						className="h-6 w-6 shrink-0 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
					>
						<span className="icon-[solar--stop-circle-linear] h-3.5 w-3.5" />
					</Button>
				)}
			</div>
			{item.statusMessage && (
				<div className="mt-1.5 line-clamp-3 break-words text-[11px] leading-relaxed text-muted-foreground">
					{item.statusMessage}
				</div>
			)}
		</div>
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
				<div className="flex shrink-0 items-center justify-end px-2.5 pt-2">
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
