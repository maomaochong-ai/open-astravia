import type { JSX } from "react";
import { useId, useState } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";

export interface ThinkingBlockViewLabels {
	readonly title: string;
	/** 省略则不显示行数（work 模式只要一句「正在思考」）。 */
	readonly lineCount?: (count: number) => string;
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
		<div className="min-w-0 w-full">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				data-export-toggle={panelId}
				data-export-label-collapsed={labels.title}
				data-export-label-expanded={labels.title}
				aria-expanded={expanded}
				className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
			>
				<span className="icon-[solar--lightbulb-bolt-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
				<span className="min-w-0 truncate text-[12px] text-muted-foreground/70">{labels.title}</span>
				{labels.lineCount && (
					<span className="shrink-0 text-[11px] text-muted-foreground/40">
						{labels.lineCount(lines.length)}
					</span>
				)}
				<span
					className={`icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
				/>
			</button>
			<CollapsePanel
				open={expanded || exportMode}
				id={panelId}
				exportPanel={exportMode}
				hidden={exportMode && !expanded}
			>
				<div className="ml-4 border-l border-border/50 pl-3 pt-1 pb-2">
					<div className="whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-muted-foreground/70">
						{text}
					</div>
				</div>
			</CollapsePanel>
		</div>
	);
}
