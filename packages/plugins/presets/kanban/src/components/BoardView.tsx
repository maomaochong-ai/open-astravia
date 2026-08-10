import { useTranslation } from "@vetta-org/plugin-sdk";
import { Button, cn } from "@vetta/ui";
import { useCallback, useMemo, useState, type DragEvent, type JSX } from "react";
import type { KanbanBoardController } from "../board/board-controller";
import { findCard } from "../board/board-store";
import { MAX_CONCURRENCY, MIN_CONCURRENCY, type KanbanCard, type KanbanLane } from "../board/types";
import { CardEditorDialog, type CardDraft } from "./CardEditorDialog";
import { CardTile } from "./CardTile";
import { useBoardModel } from "./useBoardModel";

const LANES: readonly KanbanLane[] = ["inbox", "doing", "review"];

const LANE_ACCENT: Record<KanbanLane, string> = {
	inbox: "bg-sky-500",
	doing: "bg-primary",
	review: "bg-emerald-500",
};

interface DropTarget {
	lane: KanbanLane;
	beforeCardId: string | null;
}

/**
 * 看板主视图。整页 surface：左中右三条泳道占满内容区，顶部是标题 + 并发设置 + 快速发布。
 *
 * 「不用进会话页就能发任务」是这个页面的核心：顶部输入框回车即入灵感池，
 * 卡片上的「派发」直接建会话并开跑，全程不离开看板。
 */
export function BoardView({ controller }: { controller: KanbanBoardController }): JSX.Element {
	const { t } = useTranslation();
	const model = useBoardModel(controller);
	const [quickTitle, setQuickTitle] = useState("");
	const [editorCard, setEditorCard] = useState<KanbanCard | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

	const { board, lanes, blockedBy, remainingSlots } = model;

	const openEditor = useCallback((card: KanbanCard | null) => {
		setEditorCard(card);
		setEditorOpen(true);
	}, []);

	const submitEditor = useCallback(
		(draft: CardDraft) => {
			if (editorCard) {
				controller.updateCard(editorCard.id, draft);
				return;
			}
			controller.addCard({ ...draft, lane: "inbox", ideaState: "draft" });
		},
		[controller, editorCard],
	);

	const quickAdd = useCallback(() => {
		const title = quickTitle.trim();
		if (!title) return;
		controller.addCard({ title, lane: "inbox", ideaState: "draft" });
		setQuickTitle("");
	}, [controller, quickTitle]);

	const dependencyOptions = useMemo(
		() => board.cards.filter((card) => card.id !== editorCard?.id),
		[board.cards, editorCard],
	);

	// ── 拖拽 ────────────────────────────────────────────────────────────
	const resolveTarget = (event: DragEvent<HTMLElement>, lane: KanbanLane, card: KanbanCard): DropTarget => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (event.clientY - rect.top <= rect.height / 2) return { lane, beforeCardId: card.id };
		const list = lanes[lane];
		const index = list.findIndex((candidate) => candidate.id === card.id);
		const next = index >= 0 ? list[index + 1] : undefined;
		return { lane, beforeCardId: next ? next.id : null };
	};

	const hover = (event: DragEvent<HTMLElement>, target: DropTarget): void => {
		if (!draggingId) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = "move";
		setDropTarget((prev) =>
			prev && prev.lane === target.lane && prev.beforeCardId === target.beforeCardId ? prev : target,
		);
	};

	const drop = (event: DragEvent<HTMLElement>, target: DropTarget): void => {
		event.preventDefault();
		event.stopPropagation();
		const cardId = draggingId;
		setDraggingId(null);
		setDropTarget(null);
		if (!cardId || cardId === target.beforeCardId) return;
		// 拖进「正在处理」等价于用户手动派单：走同一条闸门，避免绕过并发上限。
		const card = findCard(controller.getBoard(), cardId);
		if (target.lane === "doing" && card?.lane === "inbox") {
			void controller.dispatch(cardId, "user");
			return;
		}
		controller.moveCard(cardId, target.lane, target.beforeCardId);
	};

	const isDropBefore = (lane: KanbanLane, cardId: string): boolean =>
		dropTarget?.lane === lane && dropTarget.beforeCardId === cardId;
	const isDropAtEnd = (lane: KanbanLane): boolean => dropTarget?.lane === lane && dropTarget.beforeCardId === null;

	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="drag-region h-6 shrink-0" />

			<header className="shrink-0 px-6 pb-3">
				<div className="flex items-end justify-between gap-4">
					<div className="min-w-0">
						<h1 className="text-[22px] font-bold leading-tight tracking-tight text-foreground">{t("board.title")}</h1>
						<p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{t("board.subtitle")}</p>
					</div>
					<div className="flex shrink-0 items-center gap-3">
						<div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5">
							<span className="icon-[solar--sort-vertical-linear] h-3.5 w-3.5 text-muted-foreground" />
							<label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" htmlFor="kanban-wip">
								{t("board.concurrency")}
							</label>
							<input
								id="kanban-wip"
								type="number"
								min={MIN_CONCURRENCY}
								max={MAX_CONCURRENCY}
								value={board.concurrency}
								onChange={(event) => controller.setConcurrency(Number(event.target.value))}
								className="w-11 rounded border border-border bg-background px-1 py-0.5 text-center text-[12px] tabular-nums text-foreground outline-none focus:border-primary/60"
							/>
							<span
								className={cn(
									"rounded px-1 py-px text-[10px] font-semibold tabular-nums",
									remainingSlots === 0 ? "bg-amber-500/15 text-amber-600" : "bg-muted text-muted-foreground",
								)}
								title={t("board.remainingSlotsHint")}
							>
								{t("board.remainingSlots", { count: remainingSlots })}
							</span>
						</div>
						<Button size="sm" onClick={() => openEditor(null)}>
							<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
							{t("board.newCard")}
						</Button>
					</div>
				</div>

				<div className="mt-3 flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-2.5 py-1.5">
					<span className="icon-[solar--lightbulb-bolt-linear] h-4 w-4 shrink-0 text-muted-foreground" />
					<input
						value={quickTitle}
						placeholder={t("board.quickAddPlaceholder")}
						onChange={(event) => setQuickTitle(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") quickAdd();
						}}
						className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50"
					/>
					<Button size="xs" variant="ghost" disabled={!quickTitle.trim()} onClick={quickAdd}>
						{t("board.quickAdd")}
					</Button>
				</div>
			</header>

			{model.loading ? (
				<div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
					{t("board.loading")}
				</div>
			) : (
				<div className="grid min-h-0 flex-1 grid-cols-3 gap-3 overflow-hidden px-6 pb-5">
					{LANES.map((lane) => {
						const cards = lanes[lane];
						const overLimit = lane === "doing" && cards.length > board.concurrency;
						return (
							<section
								key={lane}
								className="flex min-h-0 flex-col rounded-xl border border-border/60 bg-muted/20"
								onDragOver={(event) => hover(event, { lane, beforeCardId: null })}
								onDrop={(event) => drop(event, { lane, beforeCardId: null })}
							>
								<div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
									<span className={cn("h-1.5 w-1.5 rounded-full", LANE_ACCENT[lane])} />
									<h2 className="text-[12px] font-semibold text-foreground">{t(`lane.${lane}.title`)}</h2>
									<span className="rounded bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
										{lane === "doing" ? `${cards.length}/${board.concurrency}` : cards.length}
									</span>
									{overLimit && (
										<span
											title={t("lane.doing.overLimit")}
											className="icon-[solar--danger-triangle-linear] h-3.5 w-3.5 text-amber-500"
										/>
									)}
								</div>

								<div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
									{cards.length === 0 && (
										<p className="px-1 py-6 text-center text-[11px] leading-relaxed text-muted-foreground/60">
											{t(`lane.${lane}.empty`)}
										</p>
									)}
									{cards.map((card) => (
										<div
											key={card.id}
											onDragOver={(event) => hover(event, resolveTarget(event, lane, card))}
											onDrop={(event) => drop(event, resolveTarget(event, lane, card))}
										>
											{isDropBefore(lane, card.id) && (
												<span aria-hidden className="mb-1.5 block h-px rounded-full bg-primary" />
											)}
											<CardTile
												blockedBy={blockedBy[card.id] ?? []}
												card={card}
												dragging={draggingId === card.id}
												onAbort={() => void controller.abort(card.id)}
												onDelete={() => controller.removeCard(card.id)}
												onDispatch={() => void controller.dispatch(card.id, "user")}
												onDragEnd={() => {
													setDraggingId(null);
													setDropTarget(null);
												}}
												onDragStart={(event) => {
													event.dataTransfer.effectAllowed = "move";
													// setData 是让某些平台真正开始拖拽的前提；载荷本身用状态传。
													event.dataTransfer.setData("text/plain", card.id);
													setDraggingId(card.id);
												}}
												onEdit={() => openEditor(card)}
												onOpenSession={() => void controller.openSession(card.id)}
												onToggleIdeaState={() =>
													controller.setIdeaState(card.id, card.ideaState === "draft" ? "ready" : "draft")
												}
											/>
										</div>
									))}
									{isDropAtEnd(lane) && <span aria-hidden className="block h-px rounded-full bg-primary" />}
								</div>
							</section>
						);
					})}
				</div>
			)}

			<CardEditorDialog
				card={editorCard}
				defaultCwd={board.defaultCwd}
				dependencyOptions={dependencyOptions}
				open={editorOpen}
				onOpenChange={setEditorOpen}
				onSubmit={submitEditor}
			/>
		</div>
	);
}
