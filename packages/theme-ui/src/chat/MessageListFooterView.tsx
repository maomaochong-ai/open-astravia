import { AnimatePresence, motion, type Transition } from "motion/react";
import type { JSX, ReactNode } from "react";

const INDICATOR_INITIAL = { opacity: 0, y: 6 };
const INDICATOR_ANIMATE = { opacity: 1, y: 0 };
const INDICATOR_EXIT = { opacity: 0, y: 6 };
const INDICATOR_TRANSITION = {
	duration: 0.25,
	ease: [0.25, 0.1, 0.25, 1] as const,
} satisfies Transition;

export interface MessageListFooterViewProps {
	readonly compactionLabel: string;
	readonly isCompacting: boolean;
	readonly pluginHost?: ReactNode;
	/** 自动重试退避中的提示语；null / undefined 表示没在重试。 */
	readonly retryLabel?: string | null;
	/** 上一次失败原因的用户友好摘要。 */
	readonly retryDetail?: string | null;
	readonly showWaiting: boolean;
	readonly streamingIndicator: ReactNode;
	/** Workflow summary items (ADR-0044); rendered above the plugin host. */
	readonly workflowItems?: ReactNode;
}

function CompactionIndicator({ label }: { label: string }): JSX.Element {
	return (
		<motion.div
			initial={INDICATOR_INITIAL}
			animate={INDICATOR_ANIMATE}
			exit={INDICATOR_EXIT}
			transition={INDICATOR_TRANSITION}
			className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
		>
			<svg width={14} height={14} style={{ animation: "context-ring-spin 1s linear infinite" }}>
				<circle
					cx={7}
					cy={7}
					r={5}
					fill="none"
					stroke="currentColor"
					strokeWidth={1}
					opacity={0.3}
					className="text-muted-foreground"
				/>
				<circle
					cx={7}
					cy={7}
					r={5}
					fill="none"
					stroke="currentColor"
					strokeWidth={1}
					strokeDasharray={`${Math.PI * 5 * 0.25} ${Math.PI * 5 * 0.75}`}
					strokeLinecap="round"
					className="text-amber-500"
				/>
			</svg>
			<span className="text-[12px] text-amber-500/80">{label}</span>
		</motion.div>
	);
}

/** 重试退避期的低调提示：让「卡住不动」变成「系统正在替你重试」。 */
function RetryIndicator({ detail, label }: { detail?: string | null; label: string }): JSX.Element {
	return (
		<motion.div
			initial={INDICATOR_INITIAL}
			animate={INDICATOR_ANIMATE}
			exit={INDICATOR_EXIT}
			transition={INDICATOR_TRANSITION}
			className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
		>
			<span className="icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground/60" />
			<span className="min-w-0">
				<span className="block text-[12px] text-foreground/80">{label}</span>
				{detail ? <span className="block truncate text-[11px] text-muted-foreground/70">{detail}</span> : null}
			</span>
		</motion.div>
	);
}

export function MessageListFooterView({
	compactionLabel,
	isCompacting,
	pluginHost,
	retryDetail,
	retryLabel,
	showWaiting,
	streamingIndicator,
	workflowItems,
}: MessageListFooterViewProps): JSX.Element {
	return (
		<div className="mx-auto flex max-w-3xl flex-col gap-2 px-5 pt-0">
			<AnimatePresence initial={false}>
				{isCompacting && <CompactionIndicator key="compacting" label={compactionLabel} />}
				{!isCompacting && retryLabel ? (
					<RetryIndicator key="retrying" label={retryLabel} detail={retryDetail} />
				) : null}
			</AnimatePresence>
			{showWaiting && !isCompacting && !retryLabel && (
				<div className="flex items-center">{streamingIndicator}</div>
			)}
			{workflowItems}
			{pluginHost}
		</div>
	);
}
