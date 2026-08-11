import { useTranslation } from "@vetta-org/plugin-sdk";
import { designCountBadge } from "./gallery-model";
import type { GalleryCard as GalleryCardData } from "./gallery-store";
import { formatRelativeTime } from "./relative-time";

interface GalleryCardProps {
	card: GalleryCardData;
	onOpen(): void;
	onContextMenu(event: React.MouseEvent): void;
}

/**
 * 一张卡：上方封面、下方 info。
 *
 * 封面区固定 4:3 并 `object-cover`：全景图是原比例存的（frame 横排时会很扁），
 * 卡面统一比例才能排出整齐的网格，代价是很扁的全景只看得到中间一段。
 */
export function GalleryCard({ card, onOpen, onContextMenu }: GalleryCardProps) {
	const { t, locale } = useTranslation();
	const count = designCountBadge(card);
	const relative = formatRelativeTime(card.modifiedAt, locale);

	return (
		<button
			type="button"
			onClick={onOpen}
			onContextMenu={onContextMenu}
			className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary/60 hover:shadow-lg"
		>
			<div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/40">
				{card.coverDataUrl ? (
					<img
						src={card.coverDataUrl}
						alt=""
						className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
						draggable={false}
					/>
				) : (
					// 还没在这台机器上开过画布：用设计自己的主色刷个底，至少每张卡不一样。
					<div
						className="flex h-full w-full items-center justify-center px-4"
						style={{ backgroundColor: card.accent ?? "var(--muted)" }}
					>
						<span className="line-clamp-2 text-center text-sm font-medium text-white/90 drop-shadow">
							{card.cover.name}
						</span>
					</div>
				)}
				{card.running ? (
					<span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
						{t("gallery.card.running")}
					</span>
				) : null}
			</div>
			<div className="flex flex-col gap-0.5 px-3 py-2.5">
				<span className="truncate text-sm font-medium text-foreground">{card.name}</span>
				<span className="truncate text-xs text-muted-foreground">
					{[
						count ? t("gallery.card.designCount", { count }) : null,
						relative ?? t("gallery.card.justNow"),
					]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</div>
		</button>
	);
}
