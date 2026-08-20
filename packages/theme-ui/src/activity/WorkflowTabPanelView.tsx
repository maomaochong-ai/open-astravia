import { Button } from "@vetta/ui";
import type { JSX, ReactNode } from "react";

export interface WorkflowSwitcherItem {
	id: string;
	name: string;
	/** e.g. "1/4"; empty string when the workflow has no todos yet. */
	progressLabel: string;
	statusLabel: string;
	statusIcon: string;
	statusClassName: string;
	objective: string;
	usageLabel: string;
	errorLabel?: string;
	errorDetail?: string;
	selected: boolean;
	/** Queued / pending / running — shows the stop affordance on the selected chip. */
	active: boolean;
}

export interface WorkflowTabPanelViewProps {
	items: WorkflowSwitcherItem[];
	emptyLabel: string;
	stopLabel: string;
	/** Shown when the selected workflow has no transcript yet (queued / just started). */
	noTranscriptLabel: string;
	hasTranscript: boolean;
	/** Read-only 1:1 MessageList for the selected workflow (host-supplied). */
	messageList: ReactNode;
	onSelect: (id: string) => void;
	onStop: (id: string) => void;
}

/**
 * Workflow activity tab (ADR-0044): switcher bar on top, read-only
 * MessageList of the selected workflow below.
 */
export function WorkflowTabPanelView({
	items,
	emptyLabel,
	stopLabel,
	noTranscriptLabel,
	hasTranscript,
	messageList,
	onSelect,
	onStop,
}: WorkflowTabPanelViewProps): JSX.Element {
	if (items.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-[12px] text-muted-foreground">
				<span className="icon-[solar--users-group-rounded-linear] h-8 w-8 text-muted-foreground/40" />
				<span>{emptyLabel}</span>
			</div>
		);
	}
	const selectedItem = items.find(({ selected }) => selected);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-1.5 overflow-x-auto bg-muted/20 px-3 py-2">
				{items.map((item) => (
					<div
						key={item.id}
						className={`flex shrink-0 items-center rounded-full border transition-colors duration-200 ${
							item.selected
								? "border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/20"
								: "border-border/40 bg-background/40 hover:border-border hover:bg-accent/40"
						}`}
					>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							onClick={() => onSelect(item.id)}
							className="h-6 rounded-full px-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
						>
							<span className={`${item.statusIcon} text-[12px] ${item.statusClassName}`} />
							<span className="max-w-[120px] truncate text-[11px] font-medium">{item.name}</span>
							{item.progressLabel && <span className="font-mono text-[10px] opacity-70">{item.progressLabel}</span>}
						</Button>
						{item.selected && item.active && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								title={stopLabel}
								aria-label={stopLabel}
								onClick={() => onStop(item.id)}
								className="mr-0.5 h-5 w-5 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
							>
								<span className="icon-[solar--stop-circle-linear] h-3 w-3" />
							</Button>
						)}
					</div>
				))}
			</div>
			{selectedItem && (
				<div key={selectedItem.id} className="shrink-0 bg-background/60 px-3 py-2.5 animate-in fade-in duration-200">
					<div className="flex min-w-0 items-start gap-2">
						<span className={`${selectedItem.statusIcon} mt-0.5 h-4 w-4 shrink-0 ${selectedItem.statusClassName}`} />
						<div className="min-w-0 flex-1">
							<div className="line-clamp-2 text-[12px] leading-relaxed text-foreground" title={selectedItem.objective}>
								{selectedItem.objective}
							</div>
							<div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
								<span className={selectedItem.statusClassName}>{selectedItem.statusLabel}</span>
								{selectedItem.progressLabel && <span>{selectedItem.progressLabel}</span>}
								{selectedItem.usageLabel && <span>{selectedItem.usageLabel}</span>}
							</div>
						</div>
					</div>
					{selectedItem.errorLabel && (
						<div className="mt-2 min-w-0 rounded-lg bg-destructive/10 px-2.5 py-2 text-[10px] text-destructive">
							<div className="font-medium">{selectedItem.errorLabel}</div>
							{selectedItem.errorDetail && <div className="mt-0.5 max-h-16 overflow-auto break-words">{selectedItem.errorDetail}</div>}
						</div>
					)}
				</div>
			)}
			{hasTranscript ? (
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">{messageList}</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-[12px] text-muted-foreground">
					<span className="icon-[solar--chat-round-line-linear] h-8 w-8 text-muted-foreground/40" />
					<span>{noTranscriptLabel}</span>
				</div>
			)}
		</div>
	);
}
