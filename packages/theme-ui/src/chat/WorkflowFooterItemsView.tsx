import type { CSSProperties, JSX } from "react";

export interface WorkflowFooterItem {
	id: string;
	name: string;
	/** e.g. "1/4"; empty string when the workflow has no todos yet. */
	progressLabel: string;
	statusLabel: string;
	statusClassName: string;
	/** Queued / pending / running — shows the stop affordance. */
	active: boolean;
	/** Completed — dimmed + strikethrough row. */
	completed: boolean;
}

export interface WorkflowFooterItemsViewProps {
	items: WorkflowFooterItem[];
	/** Header text, e.g. "有 3 个工作流正在处理". */
	title: string;
	/** Any workflow still active — 3D cube loader + shimmering title. */
	processing: boolean;
	stopLabel: string;
	onOpen: (id: string) => void;
	onStop: (id: string) => void;
}

/** Theme primary — follows active theme / brand color. */
const TITLE_COLOR = "var(--primary)";
const TITLE_SHIMMER_MID = "color-mix(in srgb, var(--primary) 45%, white)";
const CUBE_COLOR = "var(--primary)";

const TITLE_SHIMMER_STYLE: CSSProperties = {
	backgroundImage: `linear-gradient(90deg, ${TITLE_COLOR} 0%, ${TITLE_COLOR} 35%, ${TITLE_SHIMMER_MID} 50%, ${TITLE_COLOR} 65%, ${TITLE_COLOR} 100%)`,
	backgroundSize: "200% 100%",
	WebkitBackgroundClip: "text",
	backgroundClip: "text",
	color: "transparent",
	animation: "workflow-title-shimmer 2.4s linear infinite",
};

const TITLE_STATIC_STYLE: CSSProperties = { color: TITLE_COLOR };

const WORKFLOW_FOOTER_CSS = `
@keyframes workflow-title-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@keyframes workflow-cube-spin {
	0% { transform: rotate(45deg) rotateX(-25deg) rotateY(25deg); }
	50% { transform: rotate(45deg) rotateX(-385deg) rotateY(25deg); }
	100% { transform: rotate(45deg) rotateX(-385deg) rotateY(385deg); }
}
.workflow-cube {
	position: relative;
	width: 9px;
	height: 9px;
	animation: workflow-cube-spin 2s infinite ease;
	transform-style: preserve-3d;
}
.workflow-cube > i {
	position: absolute;
	inset: 0;
	background-color: color-mix(in srgb, var(--primary) 20%, transparent);
	border: 1px solid ${CUBE_COLOR};
}
.workflow-cube > i:nth-of-type(1) { transform: translateZ(-4.5px) rotateY(180deg); }
.workflow-cube > i:nth-of-type(2) { transform: rotateY(-270deg) translateX(50%); transform-origin: top right; }
.workflow-cube > i:nth-of-type(3) { transform: rotateY(270deg) translateX(-50%); transform-origin: center left; }
.workflow-cube > i:nth-of-type(4) { transform: rotateX(90deg) translateY(-50%); transform-origin: top center; }
.workflow-cube > i:nth-of-type(5) { transform: rotateX(-90deg) translateY(50%); transform-origin: bottom center; }
.workflow-cube > i:nth-of-type(6) { transform: translateZ(4.5px); }
`;

/** 3D spinning cube while processing (theme primary loader). */
function CubeSpinner(): JSX.Element {
	return (
		<span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">
			<span className="workflow-cube">
				<i />
				<i />
				<i />
				<i />
				<i />
				<i />
			</span>
		</span>
	);
}

/** Settled state: square checkbox — border, gap, filled inner square. */
function DoneSquare(): JSX.Element {
	return (
		<span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">
			<span
				className="flex h-[11px] w-[11px] items-center justify-center border"
				style={{ borderColor: CUBE_COLOR }}
			>
				<span className="h-[5px] w-[5px]" style={{ backgroundColor: CUBE_COLOR }} />
			</span>
		</span>
	);
}

/**
 * Workflow summary block in the MessageList footer:
 * cube loader + theme-primary shimmering title, then a guiding-words-style
 * branch list of workflows. Click a row to open the workflow activity tab;
 * stop interrupts the child.
 */
export function WorkflowFooterItemsView({
	items,
	title,
	processing,
	stopLabel,
	onOpen,
	onStop,
}: WorkflowFooterItemsViewProps): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<div className="flex flex-col">
			<style>{WORKFLOW_FOOTER_CSS}</style>
			<div className="flex items-center gap-1.5">
				{processing ? <CubeSpinner /> : <DoneSquare />}
				<span className="text-[12px] font-bold" style={processing ? TITLE_SHIMMER_STYLE : TITLE_STATIC_STYLE}>
					{title}
				</span>
			</div>
			<div className="mt-0.5 ml-[7px] flex flex-col">
				{items.map((item, index) => (
					<div
						key={item.id}
						className={`group relative flex items-center gap-2 py-0.5 pl-3 before:absolute before:left-0 before:border-l before:border-muted-foreground/30 before:content-[''] ${
							index === items.length - 1
								? "before:top-0 before:h-[11px] before:w-2.5 before:rounded-bl-[7px] before:border-b"
								: "before:inset-y-0 before:w-0 after:absolute after:top-1/2 after:left-0 after:w-2.5 after:border-t after:border-muted-foreground/30 after:content-['']"
						} ${item.completed ? "opacity-50" : ""}`}
					>
						<button
							type="button"
							onClick={() => onOpen(item.id)}
							className="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							<span
								className={`truncate text-[12px] text-foreground transition-colors group-hover:text-primary ${
									item.completed ? "line-through" : ""
								}`}
							>
								{item.name}
							</span>
							{item.progressLabel && (
								<span className="shrink-0 rounded bg-muted px-1.5 py-[1px] font-mono text-[10px] text-muted-foreground">
									{item.progressLabel}
								</span>
							)}
							<span className={`shrink-0 text-[11px] ${item.statusClassName}`}>{item.statusLabel}</span>
						</button>
						{item.active && (
							<button
								type="button"
								title={stopLabel}
								aria-label={stopLabel}
								onClick={() => onStop(item.id)}
								className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
							>
								<span className="icon-[mdi--stop-circle-outline] text-[14px]" />
							</button>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
