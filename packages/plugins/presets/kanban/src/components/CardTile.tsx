import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn } from "@vetta/ui";
import type { DragEvent, JSX } from "react";
import { formatRelativeTime } from "../board/relative-time";
import type { KanbanCard, KanbanRunState } from "../board/types";

const RUN_STATE_META: Record<KanbanRunState, { className: string; dot?: boolean }> = {
	queued: { className: "bg-muted text-muted-foreground" },
	running: { className: "bg-primary/12 text-primary", dot: true },
	waiting: { className: "bg-amber-500/12 text-amber-600 dark:text-amber-400" },
	done: { className: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
	failed: { className: "bg-red-500/12 text-red-600 dark:text-red-400" },
};

export interface CardTileProps {
	blockedBy: string[];
	card: KanbanCard;
	dragging: boolean;
	now: number;
	onAbort: () => void;
	onApprove: () => void;
	onDelete: () => void;
	onDispatch: () => void;
	onDragEnd: () => void;
	onDragStart: (event: DragEvent<HTMLElement>) => void;
	onEdit: () => void;
	onOpenSession: () => void;
	onSendBack: () => void;
	onToggleIdeaState: () => void;
}

/**
 * 一张卡片。三条泳道共用同一张卡，靠 lane / runState 决定露出哪些动作。
 *
 * 视觉分层（从上到下）：标题行（+悬停操作）→ 正文摘要 → 交付/错误/阻塞条 →
 * 元信息行（状态、优先级、标签、时间）→ 泳道专属动作行。优先级不用徽章而用
 * 左侧色条——扫一眼列就能分出轻重，不占行内空间。
 */
export function CardTile({
	blockedBy,
	card,
	dragging,
	now,
	onAbort,
	onApprove,
	onDelete,
	onDispatch,
	onDragEnd,
	onDragStart,
	onEdit,
	onOpenSession,
	onSendBack,
	onToggleIdeaState,
}: CardTileProps): JSX.Element {
	const { t, locale } = useTranslation();
	const isInbox = card.lane === "inbox";
	const isReview = card.lane === "review";
	const isDraft = isInbox && card.ideaState === "draft";
	const linkable = !isInbox && Boolean(card.sessionPath);
	const running = card.runState === "running";
	const runMeta = card.runState ? RUN_STATE_META[card.runState] : null;

	return (
		<article
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			className={cn(
				"kanban-card-enter group/card relative cursor-grab overflow-hidden rounded-xl border bg-card p-3 transition-all duration-150",
				"hover:-translate-y-px hover:border-primary/35 hover:shadow-[0_6px_20px_-10px_rgb(0_0_0/0.25)]",
				isDraft ? "border-dashed border-border/80" : "border-border/70 shadow-[0_1px_3px_rgb(0_0_0/0.05)]",
				running && "kanban-running border-primary/40",
				dragging && "opacity-35",
			)}
		>
			{/* 优先级色条：中=琥珀，高=红；低不画。 */}
			{card.priority > 0 && (
				<span
					aria-hidden
					className={cn(
						"absolute inset-y-2 left-0 w-[3px] rounded-r-full",
						card.priority === 2 ? "bg-red-500/80" : "bg-amber-500/80",
					)}
				/>
			)}

			<div className="flex items-start gap-2">
				<button
					type="button"
					onClick={linkable ? onOpenSession : onEdit}
					title={linkable ? t("card.openSession") : t("card.edit")}
					className="min-w-0 flex-1 text-left text-[13px] font-medium leading-snug text-foreground transition-colors hover:text-primary"
				>
					{card.title || t("card.untitled")}
				</button>
				<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100">
					<button
						type="button"
						onClick={onEdit}
						title={t("card.edit")}
						className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<span className="icon-[solar--pen-2-linear] block h-3.5 w-3.5" />
					</button>
					<button
						type="button"
						onClick={onDelete}
						title={t("card.delete")}
						className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
					>
						<span className="icon-[solar--trash-bin-trash-linear] block h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{card.detail && (
				<p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/90">{card.detail}</p>
			)}

			{isReview && card.deliveryNote && (
				<div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2 py-1.5">
					<p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
						<span className="icon-[solar--box-minimalistic-linear] h-3 w-3" />
						{t("card.deliveryNote")}
					</p>
					<p className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-foreground/85">{card.deliveryNote}</p>
				</div>
			)}

			{card.error && (
				<p className="mt-2 flex items-start gap-1 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2 py-1.5 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
					<span className="icon-[solar--danger-circle-linear] mt-px h-3 w-3 shrink-0" />
					<span className="min-w-0">{card.error}</span>
				</p>
			)}

			{blockedBy.length > 0 && (
				<p className="mt-2 flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400">
					<span className="icon-[solar--lock-keyhole-minimalistic-linear] mt-px h-3 w-3 shrink-0" />
					<span className="min-w-0 truncate">{t("card.blockedBy", { titles: blockedBy.join("、") })}</span>
				</p>
			)}

			{/* 元信息行 */}
			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				{runMeta && card.runState && (
					<span
						className={cn(
							"flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
							runMeta.className,
						)}
					>
						{runMeta.dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
						{t(`runState.${card.runState}`)}
					</span>
				)}
				{card.claimedBy === "agent" && (
					<span
						title={t("card.claimedByAgent")}
						className="flex items-center gap-0.5 rounded-md bg-accent/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
					>
						<span className="icon-[solar--magic-stick-3-linear] h-2.5 w-2.5" />
						Agent
					</span>
				)}
				{card.tags.map((tag) => (
					<span key={tag} className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
						{tag}
					</span>
				))}
				<span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
					{formatRelativeTime(now, card.updatedAt, locale)}
				</span>
			</div>

			{/* 泳道专属动作行 */}
			{isInbox && (
				<div className="mt-2 flex items-center gap-1.5 border-t border-border/40 pt-2">
					<button
						type="button"
						onClick={onToggleIdeaState}
						title={t(isDraft ? "card.markReady" : "card.markDraft")}
						aria-pressed={!isDraft}
						className={cn(
							"flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
							isDraft
								? "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
								: "bg-primary/12 text-primary hover:bg-primary/20",
						)}
					>
						<span className={cn(isDraft ? "icon-[solar--pen-new-round-linear]" : "icon-[solar--check-circle-bold]", "h-3 w-3")} />
						{t(isDraft ? "ideaState.draft" : "ideaState.ready")}
					</button>
					{!isDraft && blockedBy.length === 0 && (
						<button
							type="button"
							onClick={onDispatch}
							title={t("card.dispatch")}
							className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
						>
							<span className="icon-[solar--rocket-2-linear] h-3 w-3" />
							{t("card.dispatch")}
						</button>
					)}
				</div>
			)}

			{card.lane === "doing" && (running || linkable) && (
				<div className="mt-2 flex items-center gap-1.5 border-t border-border/40 pt-2">
					{running && (
						<button
							type="button"
							onClick={onAbort}
							title={t("card.abort")}
							className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
						>
							<span className="icon-[solar--stop-circle-linear] h-3 w-3" />
							{t("card.abort")}
						</button>
					)}
					{linkable && (
						<button
							type="button"
							onClick={onOpenSession}
							className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary"
						>
							{t("card.openSession")}
							<span className="icon-[solar--alt-arrow-right-linear] h-3 w-3" />
						</button>
					)}
				</div>
			)}

			{isReview && (
				<div className="mt-2 flex items-center gap-1.5 border-t border-border/40 pt-2">
					<button
						type="button"
						onClick={onApprove}
						title={t("card.approveHint")}
						className="flex items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
					>
						<span className="icon-[solar--check-circle-linear] h-3 w-3" />
						{t("card.approve")}
					</button>
					<button
						type="button"
						onClick={onSendBack}
						title={t("card.sendBackHint")}
						className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
					>
						<span className="icon-[solar--undo-left-round-linear] h-3 w-3" />
						{t("card.sendBack")}
					</button>
					{linkable && (
						<button
							type="button"
							onClick={onOpenSession}
							className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary"
						>
							{t("card.openSession")}
							<span className="icon-[solar--alt-arrow-right-linear] h-3 w-3" />
						</button>
					)}
				</div>
			)}
		</article>
	);
}
