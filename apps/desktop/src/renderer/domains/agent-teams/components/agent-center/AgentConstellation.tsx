import { agentAvatarUrl } from "@shared/agent-teams/agent-avatar";
import type { AgentProfile } from "@vetta/agent-team";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { motion, useReducedMotion } from "motion/react";

/** 头像沿一段弧线排开：直径 36 的头像每隔 30 放一枚，故意留 6px 交叠。 */
const AVATAR = 36;
const STEP = 30;
/** 弧顶相对基线抬起的高度。 */
const LIFT = 9;
const MAX_AVATARS = 5;

export interface AgentConstellationProps {
	readonly agents: readonly AgentProfile[];
}

/**
 * Banner 右侧的装饰件：把真实智能体头像挂在一条虚线弧上，逐枚入场后各自缓慢起伏。
 * 纯装饰，不接受点击，窄容器下由外层隐藏。
 */
export function AgentConstellation({ agents }: AgentConstellationProps): JSX.Element | null {
	const reduceMotion = useReducedMotion();
	const shown = agents.slice(0, MAX_AVATARS);
	if (shown.length === 0) return null;

	const overflow = agents.length - shown.length;
	// 溢出计数片也占一个弧位，和头像一起排。
	const slots = shown.length + (overflow > 0 ? 1 : 0);
	const width = AVATAR + (slots - 1) * STEP;
	const height = AVATAR + LIFT;
	const center = (index: number): { x: number; y: number } => ({
		x: AVATAR / 2 + index * STEP,
		// 单枚头像没有弧线可言，直接压回基线。
		y: height - AVATAR / 2 - (slots > 1 ? arcLift(index, slots) : 0),
	});

	const first = center(0);
	const last = center(slots - 1);

	return (
		<div aria-hidden="true" className="relative shrink-0" style={{ width, height }}>
			{slots > 1 && (
				<svg className="absolute inset-0 overflow-visible text-primary/35" width={width} height={height} fill="none">
					<motion.path
						d={`M ${first.x} ${first.y} Q ${width / 2} ${first.y - LIFT * 2.2} ${last.x} ${last.y}`}
						stroke="currentColor"
						strokeWidth={1}
						strokeDasharray="3 4"
						strokeLinecap="round"
						initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
						animate={{ pathLength: 1, opacity: 1 }}
						transition={{ duration: 0.9, delay: 0.15, ease: "easeOut" }}
					/>
				</svg>
			)}

			{shown.map((agent, index) => {
				const { x, y } = center(index);
				return (
					<motion.span
						key={agent.id}
						className="absolute"
						style={{ left: x - AVATAR / 2, top: y - AVATAR / 2, zIndex: shown.length - index }}
						initial={reduceMotion ? false : { opacity: 0, scale: 0.6, y: 8 }}
						animate={
							reduceMotion
								? { opacity: 1, scale: 1, y: 0 }
								: { opacity: 1, scale: 1, y: [0, -3.5, 0] }
						}
						transition={
							reduceMotion
								? { duration: 0 }
								: {
										opacity: { duration: 0.4, delay: 0.1 + index * 0.09 },
										scale: { type: "spring", stiffness: 380, damping: 24, delay: 0.1 + index * 0.09 },
										y: {
											duration: 3.6 + index * 0.45,
											delay: 0.5 + index * 0.2,
											repeat: Number.POSITIVE_INFINITY,
											ease: "easeInOut",
										},
									}
						}
					>
						<AgentAvatarView
							name={agent.name}
							avatar={agentAvatarUrl(agent)}
							blueprintId={agent.blueprintId}
							size="xl"
							className="ring-2 ring-background/80 shadow-sm shadow-black/10"
						/>
					</motion.span>
				);
			})}

			{overflow > 0 && (
				<span
					className="absolute flex h-9 w-9 items-center justify-center rounded-full bg-accent/70 text-[11px] font-medium text-muted-foreground ring-2 ring-background/80"
					style={{ left: last.x - AVATAR / 2, top: last.y - AVATAR / 2 }}
				>
					+{overflow}
				</span>
			)}
		</div>
	);
}

/** 正弦弧：两端贴基线、中间抬到 LIFT。 */
function arcLift(index: number, count: number): number {
	return Math.sin(((index + 1) / (count + 1)) * Math.PI) * LIFT;
}
