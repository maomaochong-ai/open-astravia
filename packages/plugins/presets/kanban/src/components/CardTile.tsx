import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn } from "@vetta/ui";
import type { DragEvent, JSX } from "react";
import type { KanbanCard, KanbanRunState } from "../board/types";

const PRIORITY_STYLE: Record<0 | 1 | 2, string> = {
	0: "border-border/60 text-muted-foreground",
	1: "border-amber-500/50 text-amber-600 dark:text-amber-400",
	2: "border-red-500/50 text-red-600 dark:text-red-400",
};

const RUN_STATE_STYLE: Record<KanbanRunState, string> = {
	queued: "bg-muted text-muted-foreground",
	running: "bg-primary/15 text-primary",
	waiting: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	failed: "bg-red-500/15 text-red-600 dark:text-red-400",
};

export interface CardTileProps {
	blockedBy: string[];
	card: KanbanCard;
	onAbort: () => void;
	onDelete: () => void;
	onDispatch: () => void;
	onDragStart: (event: DragEvent<HTMLElement>) => void;
	onDragEnd: () => void;
	onEdit: () => void;
	onOpenSession: () => void;
	onToggleIdeaState: () => void;
	/** 当前是否为拖拽源，用于降透明度。 */
	dragging: boolean;
}

/**
 * 一张卡片。三条泳道共用同一张卡，靠 lane / runState 决定露出哪些动作——
 * 保持视觉一致，用户不需要为每条泳道重新学一遍卡片长什么样。
 */
export function CardTile({
	blockedBy,
	card,
	dragging,
	onAbort,
	onDelete,
	onDispatch,
	onDragEnd,
	onDragStart,
	onEdit,
	onOpenSession,
	onToggleIdeaState,
}: CardTileProps): JSX.Element {
	const { t } = useTranslation();
	const isInbox = card.lane === "inbox";
	const isDraft = isInbox && card.ideaState === "draft";
	const linkable = card.lane !== "inbox" && Boolean(card.sessionPath);
	const running = card.runState === "running";

	return (
		<article
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			className={cn(
				"group/card cursor-grab rounded-lg border bg-card/80 p-2.5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md",
				isDraft ? "border-dashed border-border/70" : "border-border/70",
				running && "border-primary/50 ring-1 ring-inset ring-primary/20",
				dragging && "opacity-40",
			)}
		>
			<div className="flex items-start gap-2">
				<button
					type="button"
					onClick={linkable ? onOpenSession : onEdit}
					title={linkable ? t("card.openSession") : t("card.edit")}
					className="min-w-0 flex-1 text-left text-[13px] font-medium leading-snug text-foreground hover:text-primary"
				>
					{card.title || t("card.untitled")}
				</button>
				<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
					<button
						type="button"
						onClick={onEdit}
						title={t("card.edit")}
						className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<span className="icon-[solar--pen-2-linear] block h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={onDelete}
						title={t("card.delete")}
						className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
					>
						<span className="icon-[solar--trash-bin-trash-linear] block h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{card.detail && (
				<p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{card.detail}</p>
			)}

			{card.deliveryNote && (
				<p className="mt-1.5 rounded border border-emerald-500/25 bg-emerald-500/5 px-1.5 py-1 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">
					{card.deliveryNote}
				</p>
			)}

			{card.error && (
				<p className="mt-1.5 rounded border border-red-500/25 bg-red-500/5 px-1.5 py-1 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
					{card.error}
				</p>
			)}

			{blockedBy.length > 0 && (
				<p className="mt-1.5 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
					<span className="icon-[solar--lock-keyhole-minimalistic-linear] mt-px h-3 w-3 shrink-0" />
					<span className="min-w-0 truncate">{t("card.blockedBy", { titles: blockedBy.join("、") })}</span>
				</p>
			)}

			<div className="mt-2 flex flex-wrap items-center gap-1">
				{card.priority > 0 && (
					<span className={cn("rounded border px-1 py-px text-[9px] font-semibold", PRIORITY_STYLE[card.priority])}>
						{t(card.priority === 2 ? "priority.high" : "priority.medium")}
					</span>
				)}
				{card.runState && (
					<span
						className={cn(
							"flex items-center gap-1 rounded px-1.5 py-px text-[9px] font-semibold",
							RUN_STATE_STYLE[card.runState],
						)}
					>
						{running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
						{t(`runState.${card.runState}`)}
					</span>
				)}
				{card.tags.map((tag) => (
					<span key={tag} className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
						{tag}
					</span>
				))}
				{card.claimedBy === "agent" && (
					<span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
						<span className="icon-[solar--magic-stick-3-linear] h-2.5 w-2.5" />
						{t("card.claimedByAgent")}
					</span>
				)}
			</div>

			<div className="mt-2 flex items-center gap-1">
				{isInbox && (
					<button
						type="button"
						onClick={onToggleIdeaState}
						title={t(isDraft ? "card.markReady" : "card.markDraft")}
						className={cn(
							"rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
							isDraft
								? "bg-muted text-muted-foreground hover:bg-accent"
								: "bg-primary/15 text-primary hover:bg-primary/25",
						)}
					>
						{t(isDraft ? "ideaState.draft" : "ideaState.ready")}
					</button>
				)}
				{isInbox && !isDraft && blockedBy.length === 0 && (
					<button
						type="button"
						onClick={onDispatch}
						title={t("card.dispatch")}
						className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
					>
						<span className="icon-[solar--rocket-2-linear] h-3 w-3" />
						{t("card.dispatch")}
					</button>
				)}
				{running && (
					<button
						type="button"
						onClick={onAbort}
						title={t("card.abort")}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
					>
						<span className="icon-[solar--stop-circle-linear] h-3 w-3" />
						{t("card.abort")}
					</button>
				)}
				{linkable && (
					<button
						type="button"
						onClick={onOpenSession}
						title={t("card.openSession")}
						className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary"
					>
						{t("card.openSession")}
						<span className="icon-[solar--alt-arrow-right-linear] h-3 w-3" />
					</button>
				)}
			</div>
		</article>
	);
}
