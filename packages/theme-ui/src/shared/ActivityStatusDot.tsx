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
 * 光晕（.activity-dot-halo）扩散淡出、核心点（.activity-dot-core）同拍呼吸——动画不写在 CSS 里：
 * 毛玻璃窗口每出一帧都要整窗重合成，一个 6px 的点 60fps 逐帧插值就足以让 GPU 常年不闲。
 * 由宿主（desktop 的 live-animations）按类名挂 steps(16) 的合成器动画并与其它指示器锁同一相位；
 * 没有宿主动画时光晕保持不可见、核心点全亮。
 */
export const ACTIVITY_STATUS_DOT_CSS = `
.activity-dot-halo { opacity: 0; }
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
					<span className={cn("activity-dot-halo absolute h-1.5 w-1.5 rounded-full", background)} />
					<span className={cn("activity-dot-core relative h-1.5 w-1.5 rounded-full", background)} />
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
