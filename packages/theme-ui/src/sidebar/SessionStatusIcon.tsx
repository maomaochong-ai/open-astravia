import type { JSX } from "react";
import { cn } from "@vetta/ui";

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
				data-session-leading-icon="true"
				className={cn(
					"project-running-icon icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin",
					active ? "text-primary" : "text-muted-foreground",
				)}
			/>
		);
	}
	if (scheduled) {
		return (
			<span
				data-session-leading-icon="true"
				className="icon-[solar--clock-circle-linear] h-3.5 w-3.5 shrink-0 text-primary/80"
			/>
		);
	}
	return (
		<span
			data-session-leading-icon="true"
			className={cn(
				"icon-[solar--chat-round-line-linear] h-3.5 w-3.5 shrink-0",
				active ? "text-foreground/70" : "text-muted-foreground/50",
			)}
		/>
	);
}
