import { motion } from "motion/react";
import type { Transition } from "motion/react";
import type { JSX, ReactNode } from "react";
import { memo, useId, useState } from "react";
import { CollapsePanel } from "../shared/CollapsePanel";
import { CopyIconButton } from "./CopyIconButton";

/** Slide-up + fade for new message segments (not typewriter). */
const SEGMENT_INITIAL = { opacity: 0, y: 16 };
const SEGMENT_ANIMATE = { opacity: 1, y: 0 };
const SEGMENT_TRANSITION = {
	duration: 0.36,
	ease: [0.22, 1, 0.36, 1] as const,
} satisfies Transition;

export interface ToolCallGroupViewLabels {
	summary: string;
}

export interface ToolCallGroupViewProps {
	blockCount: number;
	summary: string;
	allDone: boolean;
	exportMode?: boolean;
	/** Force open (e.g. marketing story while tools stream in). */
	forceExpanded?: boolean;
	/** Expanded tool/thinking rows. */
	children: ReactNode;
}

export function ToolCallGroupView({
	blockCount,
	summary,
	allDone,
	exportMode = false,
	forceExpanded = false,
	children,
}: ToolCallGroupViewProps): JSX.Element {
	const [expanded, setExpanded] = useState(forceExpanded);
	const generatedId = useId();
	const panelId = exportMode ? `export-tool-group-${generatedId}` : undefined;
	const open = expanded || exportMode || forceExpanded;

	return (
		<div className="relative w-fit max-w-full overflow-hidden rounded-lg px-1 py-0.5">
			<div className="inline-block max-w-full align-top">
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					data-export-toggle={panelId}
					aria-expanded={open}
					className="inline-flex max-w-full items-center gap-2 rounded-lg pr-2 py-1 text-left transition-colors hover:bg-muted/60"
				>
					<span
						className={`icon-[mdi--chevron-right] h-4 w-4 shrink-0 text-muted-foreground/80 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
					/>
					<span className="flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1.5 text-[11px] font-medium text-muted-foreground/60">
						{blockCount}
					</span>
					<span
						className={`min-w-0 truncate text-[12px] text-muted-foreground/50 ${allDone ? "" : "tool-call-shimmer-text"}`}
					>
						{summary}
					</span>
				</button>
			</div>
			<CollapsePanel
				open={open}
				id={panelId}
				exportPanel={exportMode}
				hidden={exportMode && !expanded && !forceExpanded}
			>
				<div className="flex flex-col gap-0.5 pl-2 pr-1 pb-1">{children}</div>
			</CollapsePanel>
		</div>
	);
}

export interface SegmentShellProps {
	animateIn?: boolean;
	children: ReactNode;
}

export const SegmentShell = memo(function SegmentShell({
	animateIn = false,
	children,
}: SegmentShellProps): JSX.Element | null {
	if (!children) return null;
	// Always the same wrapper so flipping animateIn does not remount children
	// (that remount dumped the whole segment as one flash).
	return (
		<motion.div
			initial={animateIn ? SEGMENT_INITIAL : false}
			animate={SEGMENT_ANIMATE}
			transition={SEGMENT_TRANSITION}
		>
			{children}
		</motion.div>
	);
});

export interface ErrorBlockViewLabels {
	/** 一句人话的现象描述，如「请求太频繁了」。 */
	title: string;
	/** 一句建议，如「稍等片刻再发一次」。可省。 */
	hint?: string;
	/** 副标题补充，如「已自动重试 3 次」「重复出现 4 次」。可省。 */
	note?: string;
	showDetail: string;
	hideDetail: string;
	copy: string;
	copied: string;
}

export interface ErrorBlockViewProps {
	/** iconify 类名，如 "icon-[mdi--timer-sand]"。 */
	iconClass: string;
	labels: ErrorBlockViewLabels;
	/** provider 原文，只出现在折叠区。 */
	detail: string;
	expanded: boolean;
	onToggleExpanded: () => void;
	/** 需要用户离开对话去处理时给一个落点（配额、鉴权）。 */
	action?: { label: string; onClick: () => void };
	/** 导出态没有交互，原文直接展开。 */
	exportMode?: boolean;
}

/**
 * 对话流里的错误卡。刻意不用 destructive 红：这里绝大多数是限流 / 网络抖动一类
 * 的暂时性状况，红底红框会把每次抖动都渲染成事故。紧迫性交给图标、文案和动作
 * 按钮表达。分类与文案由调用方决定，本组件只负责呈现。
 */
export function ErrorBlockView({
	iconClass,
	labels,
	detail,
	expanded,
	onToggleExpanded,
	action,
	exportMode = false,
}: ErrorBlockViewProps): JSX.Element {
	const generatedId = useId();
	const panelId = `error-detail-${generatedId}`;
	const open = expanded || exportMode;

	return (
		<div className="w-full rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
			<div className="flex items-start gap-2.5">
				<span className={`${iconClass} mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70`} />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span className="text-[13px] font-medium leading-[1.5] text-foreground/85">{labels.title}</span>
						{labels.note ? <span className="text-[12px] text-muted-foreground/60">{labels.note}</span> : null}
					</div>
					{labels.hint ? (
						<p className="mt-0.5 text-[12.5px] leading-[1.6] text-muted-foreground/80">{labels.hint}</p>
					) : null}
					<div className="mt-1.5 flex flex-wrap items-center gap-1">
						{action ? (
							<button
								type="button"
								onClick={action.onClick}
								className="inline-flex h-6 items-center rounded px-1.5 text-[12px] font-medium text-foreground/75 transition-colors hover:bg-muted/70 hover:text-foreground"
							>
								{action.label}
							</button>
						) : null}
						<button
							type="button"
							onClick={onToggleExpanded}
							data-export-toggle={exportMode ? panelId : undefined}
							aria-expanded={open}
							aria-controls={panelId}
							className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[12px] text-muted-foreground/60 transition-colors hover:bg-muted/70 hover:text-foreground/80"
						>
							<span
								className={`icon-[mdi--chevron-right] h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
							/>
							{open ? labels.hideDetail : labels.showDetail}
						</button>
						<CopyIconButton
							getText={() => detail}
							label={labels.copy}
							labels={{ label: labels.copy, copied: labels.copied }}
						/>
					</div>
				</div>
			</div>
			<CollapsePanel open={open} id={panelId} exportPanel={exportMode}>
				<pre className="mt-2 max-h-60 overflow-auto rounded border border-border/50 bg-background/60 px-2 py-1.5 font-mono text-[11.5px] leading-[1.55] text-muted-foreground/75">
					{detail}
				</pre>
			</CollapsePanel>
		</div>
	);
}
