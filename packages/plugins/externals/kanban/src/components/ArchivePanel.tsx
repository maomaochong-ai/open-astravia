import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import type { JSX, ReactNode } from "react";
import { formatRelativeTime } from "../board/relative-time";
import type { KanbanCard } from "../board/types";

export interface ArchivePanelProps {
	cards: readonly KanbanCard[];
	now: number;
	onDelete: (cardId: string) => void;
	onRestore: (cardId: string) => void;
	trigger: ReactNode;
}

/**
 * 已归档交付的回看面板。交付历史是资产：验收通过后卡片离开泳道保持板面干净，
 * 但仍能在这里翻到、恢复回「待检查」，或彻底删除。
 */
export function ArchivePanel({ cards, now, onDelete, onRestore, trigger }: ArchivePanelProps): JSX.Element {
	const { t, locale } = useTranslation();

	return (
		<Popover>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent data-vetta-plugin-root="kanban" align="end" sideOffset={8} className="w-80 p-0">
				<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
					<span className="icon-[solar--archive-minimalistic-linear] h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-[12px] font-semibold text-foreground">{t("archive.title")}</span>
					<span className="rounded bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
						{cards.length}
					</span>
				</div>
				<div className="max-h-80 overflow-y-auto p-1.5">
					{cards.length === 0 && (
						<p className="px-2 py-8 text-center text-[11px] leading-relaxed text-muted-foreground/60">
							{t("archive.empty")}
						</p>
					)}
					{cards.map((card) => (
						<div
							key={card.id}
							className={cn(
								"group/row flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40",
							)}
						>
							<span className="icon-[solar--check-circle-bold] mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500/70" />
							<div className="min-w-0 flex-1">
								<p className="truncate text-[12px] font-medium text-foreground">{card.title}</p>
								{card.deliveryNote && (
									<p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground/80">{card.deliveryNote}</p>
								)}
								<p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground/50">
									{formatRelativeTime(now, card.archivedAt ?? card.updatedAt, locale)}
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
								<button
									type="button"
									title={t("archive.restore")}
									onClick={() => onRestore(card.id)}
									className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								>
									<span className="icon-[solar--refresh-square-linear] block h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									title={t("card.delete")}
									onClick={() => onDelete(card.id)}
									className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
								>
									<span className="icon-[solar--trash-bin-trash-linear] block h-3.5 w-3.5" />
								</button>
							</div>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
