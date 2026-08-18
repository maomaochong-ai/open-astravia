import { cn } from "@vetta/ui";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** 与设置页入场一致的曲线（DESIGN.md §5.1）：opacity + y，duration ≤ 0.5s。 */
const ENTER_EASE = [0.16, 1, 0.3, 1] as const;
const ENTER_DURATION = 0.36;
const ENTER_STAGGER = 0.05;

/**
 * 详情页块级入场：按 index 递增 delay，尊重 prefers-reduced-motion。
 * `empty:hidden` 让子区块返回 null 时不占据父级 gap。
 */
export function AbilityDetailEnter({
	index = 0,
	className,
	children,
}: {
	index?: number;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	const reduceMotion = useReducedMotion();

	if (reduceMotion) return <div className={cn("empty:hidden", className)}>{children}</div>;

	return (
		<motion.div
			className={cn("empty:hidden", className)}
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: ENTER_DURATION, delay: index * ENTER_STAGGER, ease: ENTER_EASE }}
		>
			{children}
		</motion.div>
	);
}
