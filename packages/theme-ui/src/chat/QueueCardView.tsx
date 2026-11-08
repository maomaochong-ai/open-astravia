import { Reorder, useDragControls } from "motion/react";
import type { JSX } from "react";

export interface QueueCardItem {
	id: string;
	displayText: string;
	kind?: "message" | "context_compaction";
	/** 压缩屏障之前的普通消息才允许跳过等待立即发送。 */
	canSendNow?: boolean;
}

export interface QueueCardViewLabels {
	empty: string;
	sendNow: string;
	delete: string;
	/** 把这条消息撤回输入框再编辑。 */
	recall: string;
	/** 把这条排队消息立即注入当前回合（steer），不打断正在跑的回答。 */
	guide: string;
}

/** abort/error 后队列暂停时的提示条：说明原因并提供「继续发送」入口。 */
export interface QueueCardPausedBanner {
	label: string;
	resumeLabel: string;
	onResume: () => void;
}

export interface QueueCardViewProps {
	items: readonly QueueCardItem[];
	labels: QueueCardViewLabels;
	onReorder: (orderedIds: readonly string[]) => void;
	onSendNow: (id: string) => void;
	onRemove: (id: string) => void;
	/** 撤回输入框：队列条目出队，文本回到编辑器里可继续改。 */
	onRecall: (id: string) => void;
	/** 引导：队列条目出队后立即作为 steer 注入当前回合。 */
	onGuide: (id: string) => void;
	paused?: QueueCardPausedBanner;
}

export function QueueCardView({
	items,
	labels,
	onReorder,
	onSendNow,
	onRemove,
	onRecall,
	onGuide,
	paused,
}: QueueCardViewProps): JSX.Element {
	// Reorder.Group needs a mutable array of the same value identities.
	const reorderValues = items as QueueCardItem[];

	if (items.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center px-4 py-6 text-xs text-muted-foreground">
				{labels.empty}
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{paused ? (
				<div className="flex items-center justify-between gap-2 border-b border-border/50 bg-amber-500/10 px-2.5 py-1.5">
					<span className="min-w-0 flex-1 truncate text-[11px] leading-snug text-amber-600 dark:text-amber-400">
						{paused.label}
					</span>
					<button
						type="button"
						onClick={paused.onResume}
						className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
					>
						{paused.resumeLabel}
					</button>
				</div>
			) : null}
			<Reorder.Group
				axis="y"
				values={reorderValues}
				onReorder={(next) => onReorder(next.map((item) => item.id))}
				className="flex flex-col p-1.5"
			>
				{reorderValues.map((item) => (
					<QueueItemRow
						key={item.id}
						item={item}
						sendNowTitle={labels.sendNow}
						deleteTitle={labels.delete}
						recallTitle={labels.recall}
						guideTitle={labels.guide}
						onSendNow={onSendNow}
						onRemove={onRemove}
						onRecall={onRecall}
						onGuide={onGuide}
					/>
				))}
			</Reorder.Group>
		</div>
	);
}

function QueueItemRow({
	item,
	sendNowTitle,
	deleteTitle,
	recallTitle,
	guideTitle,
	onSendNow,
	onRemove,
	onRecall,
	onGuide,
}: {
	item: QueueCardItem;
	sendNowTitle: string;
	deleteTitle: string;
	recallTitle: string;
	guideTitle: string;
	onSendNow: (id: string) => void;
	onRemove: (id: string) => void;
	onRecall: (id: string) => void;
	onGuide: (id: string) => void;
}): JSX.Element {
	const dragControls = useDragControls();

	return (
		<Reorder.Item
			value={item}
			dragListener={false}
			dragControls={dragControls}
			initial={{ opacity: 0, height: 0 }}
			animate={{ opacity: 1, height: "auto" }}
			exit={{ opacity: 0, height: 0 }}
			transition={{ duration: 0.15 }}
			className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/30"
		>
			<button
				type="button"
				onPointerDown={(e) => dragControls.start(e)}
				className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
			>
				<span className="icon-[solar--hamburger-menu-linear] text-sm" />
			</button>
			{item.kind === "context_compaction" || item.canSendNow === false ? (
				<div className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12px] leading-snug text-foreground">
					{item.kind === "context_compaction" ? (
						<span className="h-3.5 w-3.5 shrink-0 rounded-full border border-primary" aria-hidden="true" />
					) : null}
					<span className="truncate">{item.displayText}</span>
				</div>
			) : (
				<button
					type="button"
					onClick={() => onSendNow(item.id)}
					title={sendNowTitle}
					className="min-w-0 flex-1 truncate text-left text-[12px] leading-snug text-foreground"
				>
					{item.displayText}
				</button>
			)}
			{/* 引导与「立即发送」同一道闸：压缩屏障之后、或压缩正在执行时，把消息插进当前回合
			    会绕过屏障建立的顺序，内核也会以 missing 回绝——所以按钮不出现，而不是点了没反应。 */}
			{item.kind === "context_compaction" || item.canSendNow === false ? null : (
				<button
					type="button"
					onClick={() => onGuide(item.id)}
					title={guideTitle}
					aria-label={guideTitle}
					className="flex shrink-0 items-center text-muted-foreground/70 transition-colors hover:text-primary"
				>
					<span className="icon-[solar--routing-2-linear] text-sm" />
				</button>
			)}
			{item.kind === "context_compaction" ? null : (
				<button
					type="button"
					onClick={() => onRecall(item.id)}
					title={recallTitle}
					aria-label={recallTitle}
					className="flex shrink-0 items-center text-muted-foreground/70 transition-colors hover:text-foreground"
				>
					<span className="icon-[solar--pen-2-linear] text-sm" />
				</button>
			)}
			<button
				type="button"
				onClick={() => onRemove(item.id)}
				title={deleteTitle}
				aria-label={deleteTitle}
				className="flex shrink-0 items-center text-muted-foreground/70 transition-colors hover:text-destructive"
			>
				<span className="icon-[solar--trash-bin-trash-linear] text-sm" />
			</button>
		</Reorder.Item>
	);
}
