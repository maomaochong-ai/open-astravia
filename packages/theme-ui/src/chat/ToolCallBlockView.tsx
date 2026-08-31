import type { JSX, ReactNode } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

const ROW_BUTTON =
	"inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors";
const GUTTER = "ml-4 min-w-0 border-l border-border/50 pl-3 pt-1 pb-2";

export interface ToolCallBlockViewProps {
	canExpand: boolean;
	expanded: boolean;
	exportMode: boolean;
	panelId?: string;
	icon: string;
	iconColorClass: string;
	mcpServer?: string | null;
	name: string;
	detail?: string | null;
	isPending: boolean;
	currentPhase?: string | null;
	showBadge: boolean;
	badgeLabel?: string | null;
	/** Expanded body content (meta + tool-specific views). */
	body: ReactNode;
	/** When set, replaces the whole default chrome (plugin slot). */
	pluginSlot?: ReactNode;
	/**
	 * Host already rendered a sentence row (Work-mode stage). Skip the
	 * technical header so expanding a stage row does not repeat name + path.
	 */
	embedded?: boolean;
	onToggle: () => void;
}

/**
 * Tool call row + expandable result shell. Host injects tool-specific body / plugin slots.
 * Header hugs the label so the chevron sits on the text's right; max-w-full truncates
 * a long path instead of overflowing. Expanded body still uses the message column.
 */
export function ToolCallBlockView({
	canExpand,
	expanded,
	exportMode,
	panelId,
	icon,
	iconColorClass,
	mcpServer,
	name,
	detail,
	isPending,
	currentPhase,
	showBadge,
	badgeLabel,
	body,
	pluginSlot,
	embedded = false,
	onToggle,
}: ToolCallBlockViewProps): JSX.Element {
	if (pluginSlot) return <>{pluginSlot}</>;
	if (embedded) {
		return <div className="min-w-0 w-full py-0.5">{body}</div>;
	}

	return (
		<div className="min-w-0 w-full">
			<button
				type="button"
				onClick={() => canExpand && onToggle()}
				data-export-toggle={canExpand ? panelId : undefined}
				aria-expanded={expanded}
				className={`${ROW_BUTTON} ${canExpand ? "cursor-pointer hover:bg-muted/60" : "cursor-default"}`}
			>
				{isPending ? (
					<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/50" />
				) : (
					<span className={`${icon} h-3.5 w-3.5 shrink-0 ${iconColorClass}`} />
				)}
				{mcpServer && (
					<span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground/50">
						{mcpServer}
					</span>
				)}
				<span className="shrink-0 text-[12px] font-medium text-foreground/80">{name}</span>
				{detail && (
					<span className="min-w-0 truncate text-[12px] text-muted-foreground/70" title={detail}>
						{detail}
					</span>
				)}
				{isPending && currentPhase && (
					<span className="tool-call-shimmer-text min-w-0 truncate text-[12px] text-muted-foreground/60">
						{currentPhase}
					</span>
				)}
				{showBadge && badgeLabel && (
					<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/50">{badgeLabel}</span>
				)}
				{canExpand && (
					<span
						className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
					/>
				)}
			</button>

			<CollapsePanel
				open={(expanded || exportMode) && canExpand}
				id={panelId}
				exportPanel={exportMode}
				hidden={exportMode && !expanded}
			>
				<div className={GUTTER}>{body}</div>
			</CollapsePanel>
		</div>
	);
}
