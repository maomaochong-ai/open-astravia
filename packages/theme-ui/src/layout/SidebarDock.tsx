import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import type { JSX, ReactNode } from "react";
import { cn } from "@vetta-org/ui";

export interface SidebarDockProps extends Omit<HTMLMotionProps<"div">, "children"> {
	children: ReactNode;
	visible: boolean;
}

export function SidebarDock({
	children,
	className,
	visible,
	...props
}: SidebarDockProps): JSX.Element {
	return (
		<AnimatePresence initial={false}>
			{visible && (
				<motion.div
					key="sidebar-dock"
					initial={{ width: 0, opacity: 0, marginRight: -8 }}
					animate={{ width: "auto", opacity: 1, marginRight: 0 }}
					exit={{ width: 0, opacity: 0, marginRight: -8 }}
					transition={{ duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
					className={cn("overflow-visible", className)}
					{...props}
				>
					{children}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
