import type { JSX } from "react";
import { useId, useState } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

export interface ThinkingBlockViewLabels {
	readonly title: string;
	readonly lineCount: (count: number) => string;
}

export interface ThinkingBlockViewProps {
	readonly text: string;
	readonly exportMode?: boolean;
	readonly labels: ThinkingBlockViewLabels;
}

export function ThinkingBlockView({
	text,
	exportMode = false,
	labels,
}: ThinkingBlockViewProps): JSX.Element {
	const [expanded, setExpanded] = useState(false);
	const lines = text.split("\n");
	const generatedId = useId();
	const panelId = exportMode ? `export-thinking-${generatedId}` : undefined;

	return (
		<div className="group">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				data-export-toggle={panelId}
				data-export-label-collapsed={labels.title}
				data-export-label-expanded={labels.title}
				aria-expanded={expanded}
				className="inline-flex items-center gap-2 rounded-lg pr-2 py-1 text-left transition-colors hover:bg-muted/60"
			>
				<span className="icon-[mdi--lightbulb-outline] h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
				<span className="text-[12px] text-muted-foreground/50">{labels.title}</span>
				<span className="text-[11px] text-muted-foreground/30">
					{labels.lineCount(lines.length)}
				</span>
				<span
					className={`icon-[mdi--chevron-right] h-3 w-3 shrink-0 text-muted-foreground/30 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			<CollapsePanel
				open={expanded || exportMode}
				id={panelId}
				exportPanel={exportMode}
				hidden={exportMode && !expanded}
			>
				<div className="ml-2 border-l-2 border-muted-foreground/10 pl-4 pt-1 pb-2">
					<div className="whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-muted-foreground/60">
						{text}
					</div>
				</div>
			</CollapsePanel>
		</div>
	);
}
