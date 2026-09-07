import type { JSX } from "react";
import { cn } from "@astravia/ui";

export interface SessionStatusIconProps {
	active: boolean;
	running: boolean;
	scheduled: boolean;
}

export function SessionStatusIcon({
	active,
	running,
	scheduled,
}: SessionStatusIconProps): JSX.Element {
	if (running) {
		return (
			<span
				className={cn(
					"project-running-icon icon-[solar--refresh-linear] ml-[20px] h-3.5 w-3.5 shrink-0 animate-spin",
					active ? "text-primary" : "text-muted-foreground",
				)}
			/>
		);
	}
	if (scheduled) {
		return <span className="icon-[solar--clock-square-linear] ml-[20px] h-3.5 w-3.5 shrink-0 text-primary/80" />;
	}
	return (
		<span
			className={cn(
				"icon-[solar--chat-round-line-linear] ml-[20px] h-3.5 w-3.5 shrink-0",
				active ? "text-foreground/70" : "text-muted-foreground/50",
			)}
		/>
	);
}
