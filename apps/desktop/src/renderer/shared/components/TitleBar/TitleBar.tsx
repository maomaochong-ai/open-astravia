import { type ReactNode } from "react";
import { WindowControls } from "@shared/app-shell/window-controls";
import { cn } from "../../lib/utils";
import { isMac } from "../../lib/platform";

export interface TitleBarProps {
	className?: string;
	children?: ReactNode;
}

export function TitleBar({ className, children }: TitleBarProps): JSX.Element | null {
	if (isMac) {
		return null;
	}

	return (
		<header className={cn("title-bar flex h-9 shrink-0 items-center bg-background/85 select-none", className)}>
			<div className="drag-region flex flex-1 items-center px-3" />
			{children}
			<div className="flex items-center pr-1">
				<WindowControls />
			</div>
		</header>
	);
}
