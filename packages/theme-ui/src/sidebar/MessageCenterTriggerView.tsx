import type { JSX } from "react";
import { Button } from "@vetta-org/ui";
import { cn } from "@vetta-org/ui";

export interface MessageCenterTriggerViewProps {
	readonly open: boolean;
	readonly totalUnread: number;
	readonly title: string;
	readonly onOpen: () => void;
}

export function MessageCenterTriggerView({
	open,
	totalUnread,
	title,
	onOpen,
}: MessageCenterTriggerViewProps): JSX.Element {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			onClick={onOpen}
			className={cn("no-drag relative", open && "bg-accent text-foreground")}
			title={title}
		>
			<span
				className={cn("inline-flex h-4 w-4 items-center justify-center", totalUnread > 0 && "message-bell-swing")}
			>
				<span className="icon-[solar--bell-linear] h-4 w-4" />
			</span>
			{totalUnread > 0 && (
				<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm">
					{totalUnread}
				</span>
			)}
		</Button>
	);
}
