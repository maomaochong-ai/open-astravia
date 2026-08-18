import { useEffect, useRef } from "react";
import { cn } from "@shared/lib/utils";
import { useQuickPanelTranslation } from "./i18n";
import { relativeTime } from "./relativeTime";
import type { QuickPanelItem, QuickPanelItemStatus } from "./useQuickPanelSessions";

/** 单个列表项的固定高度（px）。与 RecentList 的可视高度计算保持一致。 */
export const QUICK_PANEL_ITEM_HEIGHT = 50;

interface RecentItemProps {
	item: QuickPanelItem;
	active: boolean;
	onMouseEnter: () => void;
	onClick: () => void;
}

function StatusIcon({ status, active }: { status: QuickPanelItemStatus; active: boolean }): JSX.Element {
	if (status === "running") {
		return (
			<span className="icon-[solar--refresh-linear] h-4 w-4 shrink-0 animate-spin text-primary" />
		);
	}
	if (status === "pending-question") {
		return (
			<span className="icon-[solar--question-circle-linear] h-4 w-4 shrink-0 text-amber-400" />
		);
	}
	return (
		<span
			className={cn(
				"icon-[solar--chat-round-line-linear] h-4 w-4 shrink-0",
				active ? "text-foreground/70" : "text-muted-foreground/50",
			)}
		/>
	);
}

export function RecentItem({ item, active, onMouseEnter, onClick }: RecentItemProps): JSX.Element {
	const t = useQuickPanelTranslation();
	const ref = useRef<HTMLButtonElement>(null);
	const rt = relativeTime(item.modifiedAt);
	const timeText = rt.count === undefined ? t(rt.key) : t(rt.key, { count: rt.count });
	const statusLabel =
		item.status === "running"
			? t("status.running")
			: item.status === "pending-question"
				? t("status.pending")
				: "";

	// 高亮项（键盘上下键移动到此）自动滚入可视区。
	useEffect(() => {
		if (active) ref.current?.scrollIntoView({ block: "nearest" });
	}, [active]);

	return (
		<button
			ref={ref}
			type="button"
			onMouseEnter={onMouseEnter}
			onClick={onClick}
			title={item.title}
			style={{ height: QUICK_PANEL_ITEM_HEIGHT }}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-100",
				// 玻璃背景上用半透明前景叠加，避免实心深色块显脏。
				active ? "bg-foreground/10" : "hover:bg-foreground/[0.06]",
			)}
		>
			<StatusIcon status={item.status} active={active} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[13px] font-medium text-foreground">{item.title}</span>
				{item.lastMessagePreview ? (
					<span className="truncate text-[11px] text-muted-foreground">{item.lastMessagePreview}</span>
				) : null}
			</div>
			{statusLabel ? (
				<span
					className={cn(
						"shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
						item.status === "pending-question"
							? "bg-amber-400/15 text-amber-400"
							: "bg-primary/15 text-primary",
					)}
				>
					{statusLabel}
				</span>
			) : null}
			<span className="shrink-0 text-[11px] text-muted-foreground">{timeText}</span>
		</button>
	);
}
