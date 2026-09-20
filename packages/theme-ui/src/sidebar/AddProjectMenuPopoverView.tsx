import { AnimatePresence, motion } from "motion/react";
import type { JSX } from "react";
import { AddProjectMenuItem } from "./AddProjectMenuItem";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface AddProjectMenuPopoverItem {
	action: string;
	icon: string;
	label: string;
	onSelect: () => void;
}

export interface AddProjectMenuPopoverViewProps {
	items: AddProjectMenuPopoverItem[];
	open: boolean;
	variant: "icon" | "navItem";
}

export function AddProjectMenuPopoverView({
	items,
	open,
	variant,
}: AddProjectMenuPopoverViewProps): JSX.Element {
	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0, scale: 0.95, y: -4 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, y: -4 }}
					transition={{ duration: 0.12 }}
					className={cn(
						// 按内容撑开而不是写死宽度：菜单项文案随语言变化，写死会把较长的项截断。
						"absolute z-50 mt-1 w-max min-w-[150px] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl",
						variant === "navItem" ? "left-0 top-full" : "right-0 top-full",
					)}
				>
					{items.map((item) => (
						<AddProjectMenuItem
							key={item.action}
							icon={item.icon}
							label={item.label}
							onSelect={item.onSelect}
						/>
					))}
				</motion.div>
			)}
		</AnimatePresence>
	);
}
