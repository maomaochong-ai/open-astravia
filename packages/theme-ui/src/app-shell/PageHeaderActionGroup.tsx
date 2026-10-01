import type { JSX, ReactNode } from "react";
import { cn } from "@astravia-org/ui";

export interface PageHeaderActionGroupProps {
	children?: ReactNode;
	className?: string;
}

export function PageHeaderActionGroup({ children, className }: PageHeaderActionGroupProps): JSX.Element {
	return (
		<div className={cn("no-drag flex shrink-0 items-center gap-1", className)}>
			{children}
		</div>
	);
}
