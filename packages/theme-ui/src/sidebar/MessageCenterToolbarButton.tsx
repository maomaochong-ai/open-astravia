import type { JSX, ReactNode } from "react";
import { cn } from "@vetta-org/ui";

export interface MessageCenterToolbarButtonProps {
	icon: string;
	onClick: () => void;
	children: ReactNode;
}

export function MessageCenterToolbarButton({
	icon,
	onClick,
	children,
}: MessageCenterToolbarButtonProps): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			<span className={cn(icon, "h-3.5 w-3.5")} />
			{children}
		</button>
	);
}
