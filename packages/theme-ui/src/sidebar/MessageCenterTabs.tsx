import { motion } from "motion/react";
import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

export type MessageCenterTabId = "all" | "notifications" | "flowing" | "chat";

export interface MessageCenterTabItem {
	value: MessageCenterTabId;
	icon: string;
	/** Fully resolved tab label. */
	label: string;
}

export interface MessageCenterTabsProps {
	tabs: readonly MessageCenterTabItem[];
	activeTab: MessageCenterTabId;
	chatUnread: number;
	notifUnread: number;
	pendingCount: number;
	onSelect: (tab: MessageCenterTabId) => void;
	spring?: { type: "spring"; stiffness: number; damping: number };
}

const DEFAULT_SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

export function MessageCenterTabs({
	tabs,
	activeTab,
	chatUnread,
	notifUnread,
	pendingCount,
	onSelect,
	spring = DEFAULT_SPRING,
}: MessageCenterTabsProps): JSX.Element {
	return (
		<div className="flex gap-1 px-4 pb-3">
			{tabs.map(({ value, icon, label }) => {
				const isActive = activeTab === value;
				const count =
					value === "flowing"
						? pendingCount
						: value === "chat"
							? chatUnread
							: value === "notifications"
								? notifUnread
								: 0;

				return (
					<button
						key={value}
						type="button"
						onClick={() => onSelect(value)}
						className={cn(
							"relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150",
							isActive
								? "text-primary-foreground"
								: "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
						)}
					>
						{isActive && (
							<motion.span
								layoutId="msgTabActive"
								transition={spring}
								className="absolute inset-0 -z-0 rounded-lg bg-primary shadow-sm"
							/>
						)}
						<span className={cn(icon, "relative z-10 h-3.5 w-3.5")} />
						<span className="relative z-10">{label}</span>
						{count > 0 && (
							<span
								className={cn(
									"relative z-10 ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold",
									isActive
										? "bg-primary-foreground/25 text-primary-foreground"
										: "bg-primary text-primary-foreground",
								)}
							>
								{count}
							</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
