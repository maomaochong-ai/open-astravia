import { ThemeSurface } from "../appearance/ThemeSurface";
import type { JSX, ReactNode } from "react";
import { useEffect, useState } from "react";

/**
 * 逐字符入场改为纯 CSS：原来每个字符一个 motion.span，流式全程 JS 每帧写内联
 * style + 触发样式重算；CSS animation-delay 错峰能给出一模一样的画面，主线程零参与。
 */
const STREAM_CHAR_CSS = `
@keyframes stream-char-in {
	from { opacity: 0; filter: blur(6px); }
	to { opacity: 1; filter: blur(0px); }
}
.stream-char {
	display: inline-block;
	white-space: pre;
	animation: stream-char-in 420ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
`;

export interface AssistantMessageViewLabels {
	processing: string;
	predicting: string;
	streamingFold: (elapsed: number) => string;
	expandFold: (count: number) => string;
	collapseFold: (count: number) => string;
	streamingPhrases: string[];
}

export interface AssistantMessageViewProps {
	rootClassName?: string;
	timestampLabel?: string;
	durationLabel?: string;
	showDuration: boolean;
	isCurrentlyStreaming: boolean;
	isPredicting: boolean;
	conclusionText: string;
	fold:
		| { kind: "streaming"; count: number; startedAt?: number }
		| { kind: "complete"; count: number; expanded: boolean; exportPanelId?: string }
		| null;
	labels: AssistantMessageViewLabels;
	/** Bot avatar node. */
	botAvatar: ReactNode;
	/** Segment list. */
	segments: ReactNode;
	/** Export-only process segments panel. */
	exportProcessSegments?: ReactNode;
	/** Plain text fallback when no blocks. */
	fallbackText?: string;
	/** Copy + relative time row. */
	actions?: ReactNode;
	/** Plugin cards. */
	messageCards: ReactNode;
	onToggleExpanded: () => void;
}

function useElapsedSeconds(startedAt: number | undefined, active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active]);
	if (!startedAt) return 0;
	return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function AssistantFoldTip({
	state,
	count,
	expanded,
	startedAt,
	onToggle,
	exportPanelId,
	labels,
}: {
	state: "streaming" | "complete";
	count: number;
	expanded: boolean;
	startedAt?: number;
	onToggle: () => void;
	exportPanelId?: string;
	labels: AssistantMessageViewLabels;
}): JSX.Element {
	const elapsedSeconds = useElapsedSeconds(startedAt, state === "streaming");
	if (state === "streaming") {
		return (
			<div className="mb-3">
				<div className="mb-2 flex items-center">
					<span className="processing-shimmer text-[12px] font-medium">
						{labels.streamingFold(elapsedSeconds)}
					</span>
				</div>
				<div className="h-px w-full rounded-full bg-border/80" />
			</div>
		);
	}
	return (
		<div className="mb-3">
			<button
				type="button"
				onClick={onToggle}
				data-export-toggle={exportPanelId}
				data-export-label-collapsed={labels.expandFold(count)}
				data-export-label-expanded={labels.collapseFold(count)}
				aria-expanded={expanded}
				className="mb-2 inline-flex w-fit items-center gap-1.5 rounded-lg py-1 pr-1.5 text-[12px] font-medium text-muted-foreground/55 transition-colors hover:bg-muted/60 hover:text-muted-foreground"
			>
				<span
					className={`icon-[mdi--chevron-right] h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
				/>
				<span data-export-toggle-label="">
					{expanded ? labels.collapseFold(count) : labels.expandFold(count)}
				</span>
			</button>
			<div className="h-px w-full rounded-full bg-border/80" />
		</div>
	);
}

export function StreamingIndicator({ phrases }: { phrases: string[] }): JSX.Element {
	const list = Array.isArray(phrases) ? phrases : [];
	const [index, setIndex] = useState(0);
	const text = list[index] ?? "";
	const chars = Array.from(text);
	useEffect(() => {
		if (list.length <= 1) return;
		const revealMs = chars.length * 35 + 420;
		const timer = window.setTimeout(
			() => setIndex((value) => (value + 1) % list.length),
			revealMs + 1100,
		);
		return () => window.clearTimeout(timer);
	}, [index, list.length, chars.length]);
	return (
		<span className="inline-flex text-[11px] font-medium text-muted-foreground/55" aria-label={text}>
			<style>{STREAM_CHAR_CSS}</style>
			{chars.map((character, characterIndex) => (
				<span
					key={`${index}-${characterIndex}`}
					aria-hidden
					className="stream-char"
					style={{ animationDelay: `${characterIndex * 35}ms` }}
				>
					{character}
				</span>
			))}
		</span>
	);
}

export function AssistantMessageView({
	rootClassName,
	timestampLabel,
	durationLabel,
	showDuration,
	isCurrentlyStreaming,
	isPredicting,
	conclusionText,
	fold,
	labels,
	botAvatar,
	segments,
	exportProcessSegments,
	fallbackText,
	actions,
	messageCards,
	onToggleExpanded,
}: AssistantMessageViewProps): JSX.Element {
	return (
		<div
			className={["relative flex flex-col overflow-visible rounded-xl", rootClassName]
				.filter(Boolean)
				.join(" ")}
			data-theme-surface-root="chat.assistantMessage"
		>
			<ThemeSurface slot="chat.assistantMessage" />
			<div className="relative z-10 flex flex-col rounded-[inherit]">
				<div className="mb-2 flex items-center gap-2">
					{botAvatar}
					<span className="text-[13px] font-semibold text-foreground/80">Vetta</span>
					{timestampLabel && (
						<span className="text-[11px] text-muted-foreground/35">{timestampLabel}</span>
					)}
					{showDuration && durationLabel && (
						<>
							<span className="text-[11px] text-muted-foreground/20">·</span>
							<span className="text-[11px] text-muted-foreground/35">{durationLabel}</span>
						</>
					)}
					{isCurrentlyStreaming && (
						<div className="flex items-center gap-1">
							<span
								className="h-1.5 w-1.5 rounded-full bg-primary/60"
								style={{ animation: "pulse 1.5s infinite" }}
							/>
							<span className="text-[11px] text-muted-foreground/35">{labels.processing}</span>
						</div>
					)}
				</div>
				{fold?.kind === "streaming" ? (
					<AssistantFoldTip
						state="streaming"
						count={fold.count}
						expanded
						startedAt={fold.startedAt}
						onToggle={() => undefined}
						labels={labels}
					/>
				) : fold?.kind === "complete" ? (
					<AssistantFoldTip
						state="complete"
						count={fold.count}
						expanded={fold.expanded}
						onToggle={onToggleExpanded}
						exportPanelId={fold.exportPanelId}
						labels={labels}
					/>
				) : null}
				<div>
					{segments ? (
						<div className="flex flex-col gap-0.5">
							{exportProcessSegments}
							{segments}
						</div>
					) : (
						<div
							className="text-[16px] leading-[1.6] text-foreground"
							style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
						>
							{fallbackText || "\u2026"}
						</div>
					)}
				</div>
				{isCurrentlyStreaming && (
					<div className="mt-2 flex items-center">
						<StreamingIndicator phrases={labels.streamingPhrases} />
					</div>
				)}
				{(conclusionText.length > 0 || isPredicting) && !isCurrentlyStreaming && (
					<div className="mt-2 flex items-center gap-2">
						{actions}
						{isPredicting && (
							<span className="processing-shimmer text-[11px] font-medium">{labels.predicting}</span>
						)}
					</div>
				)}
				<div className="mt-2">{messageCards}</div>
			</div>
		</div>
	);
}

