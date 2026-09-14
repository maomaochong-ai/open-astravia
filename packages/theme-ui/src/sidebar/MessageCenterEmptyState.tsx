import { motion } from "motion/react";
import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

export interface MessageCenterEmptyStateProps {
	text: string;
	icon: string;
}

export function MessageCenterEmptyState({ text, icon }: MessageCenterEmptyStateProps): JSX.Element {
	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.96 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.2 }}
			className="flex flex-col items-center justify-center gap-3 py-14 text-center"
		>
			<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
				<span className={cn(icon, "h-6 w-6 text-primary/40")} />
			</div>
			<p className="text-[12px] text-muted-foreground/40">{text}</p>
		</motion.div>
	);
}
