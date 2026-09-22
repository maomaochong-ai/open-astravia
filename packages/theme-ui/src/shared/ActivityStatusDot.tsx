import { cn } from "@vetta-org/ui";
import type { JSX } from "react";

/**
 * 「有事在跑 / 没事」的状态点，待办条与底部面板 tab、折叠 pill 共用一个实现。
 *
 * 之前这套呼吸动画只存在于 `TodoProgress.tsx`，底部面板要同样的视觉，复制一份就会
 * 出现两个事实源——改一处闪法两边不一致。抽到这里后两者同源，只靠 tone 区分语义色。
 */

export type ActivityStatusDotTone = "primary" | "emerald" | "muted";

export interface ActivityStatusDotProps {
	/** true = 呼吸脉冲（运行中 / 未完成）；false = 静止点（空闲 / 已完成）。 */
	readonly pulse: boolean;
	readonly tone: ActivityStatusDotTone;
	readonly className?: string;
}

/** Tailwind 只认字面量类名，所以 tone 映射写成常量表而不是拼串。 */
const TONE_BACKGROUND: Record<ActivityStatusDotTone, string> = {
	primary: "bg-primary",
	emerald: "bg-emerald-500",
	muted: "bg-muted-foreground/60",
};

const TONE_COLOR: Record<ActivityStatusDotTone, string> = {
	primary: "var(--primary)",
	emerald: "var(--color-emerald-500)",
	muted: "var(--muted-foreground)",
};

/**
 * 光晕在前 70% 相位里扩散并淡出、后 30% 停住，核心点同拍呼吸。两者都读 theme-ui
 * styles.css 里的共享步进时钟（--vetta-live-phase / --vetta-live-wave，每 100ms 一步），
 * 而不是各自跑 60fps 关键帧：毛玻璃窗口每出一帧都要整窗重合成，一个 6px 的点逐帧
 * 插值就足以让 GPU 常年不闲。元素带 `vetta-live-phase` 类，时钟才会因它启动。
 */
export const ACTIVITY_STATUS_DOT_CSS = `
.activity-dot-halo {
	--activity-dot-progress: min(1, var(--vetta-live-phase) / 0.7);
	transform: scale(calc(0.7 + 1.4 * var(--activity-dot-progress)));
	opacity: calc(0.55 * (1 - var(--activity-dot-progress)));
}
.activity-dot-core { opacity: calc(1 - 0.45 * var(--vetta-live-wave)); }
`;

/** 关键帧注入点：每个用到状态点的根节点渲染一次，内容相同不会互相干扰。 */
export function ActivityStatusDotStyles(): JSX.Element {
	return <style>{ACTIVITY_STATUS_DOT_CSS}</style>;
}

export function ActivityStatusDot({ pulse, tone, className }: ActivityStatusDotProps): JSX.Element {
	const background = TONE_BACKGROUND[tone];
	return (
		<span
			aria-hidden
			data-status={pulse ? "active" : "idle"}
			className={cn("relative flex h-2 w-2 shrink-0 items-center justify-center", className)}
		>
			{pulse ? (
				<>
					<span className={cn("vetta-live-phase activity-dot-halo absolute h-1.5 w-1.5 rounded-full", background)} />
					<span className={cn("vetta-live-phase activity-dot-core relative h-1.5 w-1.5 rounded-full", background)} />
				</>
			) : (
				<span
					className={cn("h-1.5 w-1.5 rounded-full", background)}
					style={{ boxShadow: `0 0 0 2px color-mix(in srgb, ${TONE_COLOR[tone]} 18%, transparent)` }}
				/>
			)}
		</span>
	);
}
