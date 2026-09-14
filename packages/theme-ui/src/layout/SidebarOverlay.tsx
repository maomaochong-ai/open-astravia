import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import type { JSX, ReactNode } from "react";
import { cn } from "@vetta-org/ui";

export interface SidebarOverlayProps extends Omit<HTMLMotionProps<"div">, "children"> {
	children: ReactNode;
	visible: boolean;
}

export function SidebarOverlay({
	children,
	className,
	visible,
	...props
}: SidebarOverlayProps): JSX.Element {
	return (
		<AnimatePresence>
			{visible && (
				<motion.div
					key="sidebar-overlay"
					initial={{ opacity: 0, x: -12 }}
					animate={{ opacity: 1, x: 0 }}
					exit={{ opacity: 0, x: -12 }}
					transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
					className={cn(
						"no-drag absolute inset-y-2 left-2 z-50 overflow-visible rounded-[10px] shadow-2xl shadow-black/30",
						className,
					)}
					{...props}
				>
					{children}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
