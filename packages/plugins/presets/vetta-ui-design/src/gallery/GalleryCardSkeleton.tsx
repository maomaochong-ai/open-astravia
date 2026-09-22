/**
 * 「我的设计」首次扫描时的占位卡：和 {@link GalleryCard} 同一副骨架（4:3 封面 + 两行 info），
 * 数据到了直接原位换成真卡，版面不跳。
 */
export function GalleryCardSkeleton() {
	return (
		<div aria-hidden className="flex w-full animate-pulse flex-col overflow-hidden rounded-xl border border-border bg-card">
			<div className="aspect-[4/3] w-full bg-accent/40" />
			<div className="flex flex-col gap-1.5 px-3 py-3">
				<span className="h-3.5 w-2/3 rounded bg-accent/60" />
				<span className="h-3 w-1/3 rounded bg-accent/40" />
			</div>
		</div>
	);
}
