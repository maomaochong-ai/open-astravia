import { AnimatePresence, motion } from "motion/react";
import type { JSX } from "react";
import { cn } from "@vetta-org/ui";
import { MESSAGE_CENTER_SPRING } from "./ChatMessageListView";
import { MessageCenterEmptyState } from "./MessageCenterEmptyState";
import { MessageCenterToolbarButton } from "./MessageCenterToolbarButton";

export interface NotificationMessageListItemView {
	readonly id: number;
	readonly title: string;
	readonly body: string | null;
	readonly read: boolean;
	readonly relativeTime: string;
}

export interface NotificationMessageListViewProps {
	readonly emptyText: string;
	readonly emptyIcon: string;
	readonly hasUnread: boolean;
	readonly hasRead: boolean;
	readonly markAllReadLabel: string;
	readonly clearReadLabel: string;
	readonly deleteLabel: string;
	readonly items: readonly NotificationMessageListItemView[];
	readonly onMarkAllRead: () => void;
	readonly onClearRead: () => void;
	readonly onMarkRead: (id: number) => void;
	readonly onDelete: (id: number) => void;
}

export function NotificationMessageListView({
	emptyText,
	emptyIcon,
	hasUnread,
	hasRead,
	markAllReadLabel,
	clearReadLabel,
	deleteLabel,
	items,
	onMarkAllRead,
	onClearRead,
	onMarkRead,
	onDelete,
}: NotificationMessageListViewProps): JSX.Element {
	if (items.length === 0) {
		return <MessageCenterEmptyState text={emptyText} icon={emptyIcon} />;
	}

	return (
		<div className="flex flex-col gap-1.5 p-3">
			{(hasUnread || hasRead) && (
				<div className="flex justify-end gap-1.5 px-0.5">
					{hasUnread && (
						<MessageCenterToolbarButton icon="icon-[solar--check-read-linear]" onClick={onMarkAllRead}>
							{markAllReadLabel}
						</MessageCenterToolbarButton>
					)}
					{hasRead && (
						<MessageCenterToolbarButton
							icon="icon-[solar--notification-lines-remove-linear]"
							onClick={onClearRead}
						>
							{clearReadLabel}
						</MessageCenterToolbarButton>
					)}
				</div>
			)}
			<AnimatePresence initial={false} mode="popLayout">
				{items.map((notification) => (
					<motion.div
						key={notification.id}
						layout
						initial={{ opacity: 0, y: 8, scale: 0.98 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
						transition={MESSAGE_CENTER_SPRING}
						onClick={() => onMarkRead(notification.id)}
						className={cn(
							"group relative cursor-pointer rounded-xl border p-3.5 text-left transition-colors",
							notification.read
								? "border-border/50 bg-background hover:bg-accent/20"
								: "border-primary/30 bg-primary/5 hover:bg-primary/10",
						)}
					>
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onDelete(notification.id);
							}}
							className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
							title={deleteLabel}
						>
							<span className="icon-[solar--close-circle-linear] h-3 w-3" />
						</button>

						<div className="flex items-start gap-3">
							<div
								className={cn(
									"relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
									notification.read ? "bg-muted" : "bg-primary/15",
								)}
							>
								<span
									className={cn(
										"icon-[solar--bell-linear] h-4 w-4",
										notification.read ? "text-muted-foreground" : "text-primary",
									)}
								/>
								{!notification.read && (
									<span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-1 ring-popover" />
								)}
							</div>
							<div className="min-w-0 flex-1">
								<p
									className={cn(
										"truncate text-[12px] leading-snug",
										notification.read ? "text-muted-foreground" : "font-semibold text-foreground",
									)}
								>
									{notification.title}
								</p>
								{notification.body && (
									<p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground">
										{notification.body}
									</p>
								)}
								<p className="mt-1.5 text-[10px] text-muted-foreground/50">{notification.relativeTime}</p>
							</div>
						</div>
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}
