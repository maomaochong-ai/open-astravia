import { motion } from "motion/react";
import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

export interface PageHeaderTitleProps {
	className?: string;
	title: string;
}

export function PageHeaderTitle({ className, title }: PageHeaderTitleProps): JSX.Element {
	return (
		<motion.h1
			key={title}
			initial={{ opacity: 0, y: 2 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.18 }}
			className={cn(
				"drag-region min-w-0 select-none truncate text-[13px] font-semibold text-foreground",
				className,
			)}
		>
			{title}
		</motion.h1>
	);
}
