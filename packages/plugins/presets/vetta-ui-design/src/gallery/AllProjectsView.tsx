import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { GalleryCard } from "./GalleryCard";
import { growVisibleCount, initialVisibleCount, PROJECT_GRID_CLASS } from "./gallery-layout";
import type { GalleryCard as GalleryCardData } from "./gallery-store";

interface AllProjectsViewProps {
	/** 已按关键词过滤的全量卡片。数组引用变化即重置分页（调用方需 useMemo）。 */
	cards: GalleryCardData[];
	onOpen(card: GalleryCardData): void;
	onCardContextMenu(event: React.MouseEvent, card: GalleryCardData): void;
}

/**
 * 「全部设计」列表页：滚动到底部自动追加下一页，没有翻页按钮。
 *
 * 数据早已整批在内存里（loadGallery 一次扫完），这里的分页只是渲染侧的增量挂载：
 * 几百张卡各带一张 dataURL 封面，一次性全挂会卡首帧。哨兵进入视口就追加一页；
 * 追加后哨兵可能仍在视口内，所以 observer 跟着 visible 重建，重建时会立刻上报
 * 当前相交状态，自然把首屏填满。
 */
export function AllProjectsView({ cards, onOpen, onCardContextMenu }: AllProjectsViewProps) {
	const { t } = useTranslation();
	const [visible, setVisible] = useState(() => initialVisibleCount(cards.length));
	const [sentinel, setSentinel] = useState<HTMLElement | null>(null);

	useEffect(() => {
		setVisible(initialVisibleCount(cards.length));
	}, [cards]);

	useEffect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setVisible((current) => growVisibleCount(current, cards.length));
			},
			{ rootMargin: "300px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [sentinel, cards.length, visible]);

	return (
		<div>
			<div className={PROJECT_GRID_CLASS}>
				{cards.slice(0, visible).map((card) => (
					<GalleryCard
						key={card.cwd}
						card={card}
						onOpen={() => onOpen(card)}
						onContextMenu={(event) => onCardContextMenu(event, card)}
					/>
				))}
			</div>
			{visible < cards.length ? (
				<div ref={setSentinel} className="flex items-center justify-center py-6" aria-hidden>
					<span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
				</div>
			) : cards.length > 0 ? (
				<p className="py-6 text-center text-[11px] text-muted-foreground">{t("gallery.projects.loadedAll")}</p>
			) : null}
		</div>
	);
}
