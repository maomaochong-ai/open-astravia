import { useTranslation } from "@vetta-org/plugin-sdk";
import { cn } from "@vetta/ui";
import { useCallback, useMemo, useState, type DragEvent, type JSX } from "react";
import type { KanbanBoardController } from "../board/board-controller";
import { findCard, resolveCardModelKey } from "../board/board-store";
import { MAX_CONCURRENCY, MIN_CONCURRENCY, type KanbanCard, type KanbanLane } from "../board/types";
import { ArchivePanel } from "./ArchivePanel";
import { CardEditorDialog, type CardDraft } from "./CardEditorDialog";
import { CardTile } from "./CardTile";
import { Composer, type ComposerSubmitPayload } from "./Composer";
import { FeedbackDialog } from "./FeedbackDialog";
import { useBoardModel } from "./useBoardModel";

const LANES: readonly KanbanLane[] = ["inbox", "doing", "review"];

const LANE_META: Record<KanbanLane, { dot: string; icon: string }> = {
	inbox: { dot: "bg-sky-400", icon: "icon-[solar--lightbulb-bolt-linear]" },
	doing: { dot: "bg-primary", icon: "icon-[solar--play-circle-linear]" },
	review: { dot: "bg-emerald-400", icon: "icon-[solar--clipboard-check-linear]" },
};

interface DropTarget {
	lane: KanbanLane;
	beforeCardId: string | null;
}

/**
 * 看板主视图。布局分三层：
 * - 顶部工具带：标题 + 搜索 + WIP 步进器 + 归档 + 新建
 * - 三条泳道：占满剩余空间，各自滚动
 * - 底部 Composer：悬浮居中，与会话页 AI 输入栏同款胶囊——看板即对话入口
 */
export function BoardView({ controller }: { controller: KanbanBoardController }): JSX.Element {
	const { t } = useTranslation();
	const model = useBoardModel(controller);
	const [editorCard, setEditorCard] = useState<KanbanCard | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [feedbackCard, setFeedbackCard] = useState<KanbanCard | null>(null);
	const [feedbackOpen, setFeedbackOpen] = useState(false);
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

	const { board, lanes, laneTotals, archived, blockedBy, remainingSlots, now, query, setQuery } = model;

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

	const submitComposer = useCallback(
		(payload: ComposerSubmitPayload) => {
			const next = controller.addCard({
				title: payload.title,
				detail: payload.detail,
				cwd: payload.cwd,
				modelKey: payload.modelKey,
				priority: payload.priority,
				lane: "inbox",
				ideaState: payload.ideaState,
			});
			if (payload.dispatchNow) {
				const created = next.cards[next.cards.length - 1];
				if (created) void controller.dispatch(created.id, "user");
			}
		},
		[controller],
	);

	const openFeedback = useCallback((card: KanbanCard) => {
		setFeedbackCard(card);
		setFeedbackOpen(true);
	}, []);

	const models = controller.getModels();
	/** modelKey → 显示名；卡片徽章、编辑器都按这张表把 key 还原成人能读的名字。 */
	const modelNameByKey = useMemo(() => new Map(models.map((model) => [model.key, model.displayName])), [models]);
	const modelLabelFor = useCallback(
		(card: KanbanCard): string => {
			const key = resolveCardModelKey(board, card);
			if (!key) return "";
			// catalog 里找不到（模型被删/改名）时退回展示 key 的模型段，不要显示空白。
			return modelNameByKey.get(key) ?? key.slice(key.indexOf("/") + 1);
		},
		[board, modelNameByKey],
	);

	const dependencyOptions = useMemo(
		() => board.cards.filter((card) => card.id !== editorCard?.id && card.archivedAt === undefined),
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

	const boardEmpty = laneTotals.inbox + laneTotals.doing + laneTotals.review === 0;
	// 用量环基于名额占用（与并发闸门同一口径），与搜索过滤无关。
	const wipRatio = Math.min(1, (board.concurrency - remainingSlots) / Math.max(1, board.concurrency));

	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden bg-background">
			<div className="drag-region h-6 shrink-0" />

			{/* ── 顶部工具带 ─────────────────────────────────────────── */}
			<header className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-1">
				<div className="min-w-0">
					<h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/60 bg-clip-text text-[20px] font-bold leading-tight tracking-tight text-transparent">
						{t("board.title")}
					</h1>
					<p className="mt-px truncate text-[11px] text-muted-foreground/60">{t("board.subtitle")}</p>
				</div>

				<div className="flex-1" />

				{/* 搜索 */}
				<label
					className={cn(
						"flex h-8 w-44 items-center gap-1.5 rounded-lg border bg-card/60 px-2.5 transition-[width,border-color] duration-200 focus-within:w-56 focus-within:border-primary/30",
						query ? "border-primary/30" : "border-border/70",
					)}
				>
					<span className="icon-[solar--magnifer-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
					<input
						value={query}
						placeholder={t("board.searchPlaceholder")}
						onChange={(event) => setQuery(event.target.value)}
						className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/40"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="shrink-0 text-muted-foreground/60 hover:text-foreground"
						>
							<span className="icon-[solar--close-circle-bold] block h-3.5 w-3.5" />
						</button>
					)}
				</label>

				{/* WIP 步进器 + 用量环 */}
				<div
					className="flex h-8 items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5"
					title={t("board.remainingSlotsHint")}
				>
					<span className="relative h-4 w-4">
						<svg viewBox="0 0 16 16" className="h-4 w-4 -rotate-90" aria-hidden>
							<circle cx="8" cy="8" r="6.5" fill="none" strokeWidth="2.5" className="stroke-muted" />
							<circle
								cx="8"
								cy="8"
								r="6.5"
								fill="none"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeDasharray={`${wipRatio * 40.8} 40.8`}
								className={cn("transition-[stroke-dasharray] duration-300", remainingSlots === 0 ? "stroke-amber-500" : "stroke-primary")}
							/>
						</svg>
					</span>
					<span className="text-[11px] text-muted-foreground">{t("board.concurrency")}</span>
					<div className="flex items-center gap-0.5">
						<button
							type="button"
							aria-label={t("board.concurrencyDown")}
							disabled={board.concurrency <= MIN_CONCURRENCY}
							onClick={() => controller.setConcurrency(board.concurrency - 1)}
							className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
						>
							<span className="icon-[solar--minus-circle-linear] h-3.5 w-3.5" />
						</button>
						<span className="w-5 text-center text-[12px] font-semibold tabular-nums text-foreground">
							{board.concurrency}
						</span>
						<button
							type="button"
							aria-label={t("board.concurrencyUp")}
							disabled={board.concurrency >= MAX_CONCURRENCY}
							onClick={() => controller.setConcurrency(board.concurrency + 1)}
							className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
						>
							<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
						</button>
					</div>
				</div>

				{/* 归档回看 */}
				<ArchivePanel
					cards={archived}
					now={now}
					onDelete={(cardId) => controller.removeCard(cardId)}
					onRestore={(cardId) => controller.restore(cardId)}
					trigger={
						<button
							type="button"
							title={t("archive.title")}
							className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-card/60 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
						>
							<span className="icon-[solar--archive-minimalistic-linear] h-4 w-4" />
							{archived.length > 0 && (
								<span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[8px] font-bold tabular-nums text-white">
									{archived.length > 99 ? "99+" : archived.length}
								</span>
							)}
						</button>
					}
				/>

				{/* 详细新建 */}
				<button
					type="button"
					onClick={() => openEditor(null)}
					className="flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[12px] font-medium text-background shadow-sm transition-opacity hover:opacity-85"
				>
					<span className="icon-[solar--add-circle-linear] h-3.5 w-3.5" />
					{t("board.newCard")}
				</button>
			</header>

			{/* ── 泳道 ──────────────────────────────────────────────── */}
			{model.loading ? (
				<div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
					<span className="icon-[solar--refresh-linear] h-4 w-4 animate-spin" />
					{t("board.loading")}
				</div>
			) : boardEmpty && !query ? (
				<EmptyBoard />
			) : (
				<div className="grid min-h-0 flex-1 grid-cols-3 gap-3 overflow-hidden px-6 pb-24">
					{LANES.map((lane) => {
						const cards = lanes[lane];
						const meta = LANE_META[lane];
						const laneActive = draggingId !== null && dropTarget?.lane === lane;
						const overLimit = lane === "doing" && laneTotals.doing > board.concurrency;
						return (
							<section
								key={lane}
								className={cn(
									"flex min-h-0 flex-col rounded-2xl border bg-muted/[0.14] transition-[border-color,background-color] duration-150",
									laneActive ? "border-primary/35 bg-primary/[0.04]" : "border-border/50",
								)}
								onDragOver={(event) => hover(event, { lane, beforeCardId: null })}
								onDrop={(event) => drop(event, { lane, beforeCardId: null })}
							>
								<div className="flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2.5">
									<span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
									<h2 className="text-[12px] font-semibold tracking-wide text-foreground">{t(`lane.${lane}.title`)}</h2>
									<span className="rounded-md bg-muted/80 px-1.5 py-px text-[10px] font-medium tabular-nums text-muted-foreground">
										{lane === "doing" ? `${laneTotals.doing}/${board.concurrency}` : laneTotals[lane]}
									</span>
									{overLimit && (
										<span
											title={t("lane.doing.overLimit")}
											className="icon-[solar--danger-triangle-linear] h-3.5 w-3.5 text-amber-500"
										/>
									)}
								</div>

								<div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2 pt-0.5">
									{cards.length === 0 && (
										<div className="flex flex-col items-center gap-1.5 px-3 py-10 text-center">
											<span className={cn(meta.icon, "h-6 w-6 text-muted-foreground/25")} />
											<p className="whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground/50">
												{query ? t("board.searchEmpty") : t(`lane.${lane}.empty`)}
											</p>
										</div>
									)}
									{cards.map((card) => (
										<div
											key={card.id}
											onDragOver={(event) => hover(event, resolveTarget(event, lane, card))}
											onDrop={(event) => drop(event, resolveTarget(event, lane, card))}
										>
											{isDropBefore(lane, card.id) && <DropLine />}
											<CardTile
												blockedBy={blockedBy[card.id] ?? []}
												card={card}
												modelLabel={modelLabelFor(card)}
												dragging={draggingId === card.id}
												now={now}
												onAbort={() => void controller.abort(card.id)}
												onApprove={() => controller.archive(card.id)}
												onDelete={() => controller.removeCard(card.id)}
												onDispatch={() => void controller.dispatch(card.id, "user")}
												onDragEnd={() => {
													setDraggingId(null);
													setDropTarget(null);
												}}
												onDragStart={(event) => {
													event.dataTransfer.effectAllowed = "move";
													// setData 是让部分平台真正开始拖拽的前提；载荷本身用状态传。
													event.dataTransfer.setData("text/plain", card.id);
													setDraggingId(card.id);
												}}
												onEdit={() => openEditor(card)}
												onOpenSession={() => void controller.openSession(card.id)}
												onSendBack={() => openFeedback(card)}
												onToggleIdeaState={() =>
													controller.setIdeaState(card.id, card.ideaState === "draft" ? "ready" : "draft")
												}
											/>
										</div>
									))}
									{isDropAtEnd(lane) && cards.length > 0 && <DropLine />}
								</div>
							</section>
						);
					})}
				</div>
			)}

			{/* ── 底部 Composer（与 AI 输入栏同款胶囊）───────────────── */}
			{!model.loading && (
				<Composer
					canDispatchNow={remainingSlots > 0}
					defaultCwd={board.defaultCwd}
					hostDefaultModelKey={controller.getHostDefaultModelKey()}
					modelKey={board.defaultModelKey}
					models={models}
					onModelKeyChange={(next) => controller.setDefaultModelKey(next)}
					projects={controller.getProjects()}
					onSubmit={submitComposer}
				/>
			)}

			<CardEditorDialog
				card={editorCard}
				defaultCwd={board.defaultCwd}
				defaultModelKey={board.defaultModelKey}
				models={models}
				dependencyOptions={dependencyOptions}
				open={editorOpen}
				onOpenChange={setEditorOpen}
				onSubmit={submitEditor}
			/>
			<FeedbackDialog
				card={feedbackCard}
				open={feedbackOpen}
				onOpenChange={setFeedbackOpen}
				onSubmit={(feedback) => {
					if (feedbackCard) void controller.sendBack(feedbackCard.id, feedback);
				}}
			/>
		</div>
	);
}

function DropLine(): JSX.Element {
	return (
		<div aria-hidden className="relative mb-2 h-0.5 rounded-full bg-primary">
			<span className="absolute -left-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary" />
		</div>
	);
}

/** 空板引导：三步说明代替一片空白，让第一次打开的人知道从哪下手。 */
function EmptyBoard(): JSX.Element {
	const { t } = useTranslation();
	const steps = [
		{ icon: "icon-[solar--lightbulb-bolt-linear]", key: "capture" },
		{ icon: "icon-[solar--magic-stick-3-linear]", key: "dispatch" },
		{ icon: "icon-[solar--clipboard-check-linear]", key: "review" },
	] as const;
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-6 pb-24">
			<div className="flex flex-col items-center gap-1.5">
				<span className="icon-[solar--widget-4-linear] h-10 w-10 text-muted-foreground/20" />
				<p className="text-[14px] font-semibold text-foreground">{t("empty.title")}</p>
				<p className="text-[12px] text-muted-foreground/70">{t("empty.subtitle")}</p>
			</div>
			<div className="flex items-stretch gap-3">
				{steps.map((step, index) => (
					<div
						key={step.key}
						className="flex w-44 flex-col items-center gap-1.5 rounded-xl border border-border/50 bg-card/40 px-4 py-4 text-center"
					>
						<span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
							<span className={cn(step.icon, "h-4 w-4 text-primary")} />
						</span>
						<p className="text-[12px] font-medium text-foreground">
							{index + 1}. {t(`empty.step.${step.key}.title`)}
						</p>
						<p className="text-[10px] leading-relaxed text-muted-foreground/70">{t(`empty.step.${step.key}.detail`)}</p>
					</div>
				))}
			</div>
		</div>
	);
}
