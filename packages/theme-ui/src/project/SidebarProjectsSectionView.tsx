import { cn } from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";

export interface SidebarProjectsSectionViewProps {
	className?: string;
	classNames?: {
		list?: string;
		toolbar?: string;
	};
	filterSelect: ReactNode;
	addProjectMenu: ReactNode;
	panel: ReactNode;
}

export function SidebarProjectsSectionView({
	className,
	classNames,
	filterSelect,
	addProjectMenu,
	panel,
}: SidebarProjectsSectionViewProps): JSX.Element {
	return (
		<div className={cn("flex min-h-0 flex-1 flex-col", className)}>
			{/* Inline z-index keeps the dropdown above the project list below. */}
			<div
				className={cn("group flex items-center justify-between pb-1 pl-2 pr-3 pt-1", classNames?.toolbar)}
				style={{ position: "relative", zIndex: 20 }}
			>
				{filterSelect}
				{addProjectMenu}
			</div>
			{panel}
		</div>
	);
}
