import { useTranslation } from "@vetta-org/plugin-sdk";
import { getPluginCtx } from "../plugin-context";
import { toVettaFileUrl } from "./file-url";
import type { Snapshot } from "./snapshots";
import { SwiperShell } from "./SwiperShell";

/** Thumbnails are a fixed height; width follows the frame's real aspect ratio. */
const ITEM_HEIGHT = "h-48";

/** 截图进行中的占位：竖屏比例的呼吸方块，占住最新一版的位置。 */
function CaptureSkeleton() {
	const { t } = useTranslation();
	return (
		<div
			className={`vetd-shot-pulse flex w-24 shrink-0 items-center justify-center rounded-lg border border-border ${ITEM_HEIGHT}`}
			style={{ background: "color-mix(in oklab, var(--foreground) 6%, transparent)" }}
		>
			<span className="px-1 text-center text-[10px] text-muted-foreground">{t("card.screenshot.capturing")}</span>
		</div>
	);
}

/**
 * 同一 frame 的历史截图，最新在左。溢出时左右箭头翻动一整屏；点击缩略图打开大图预览，
 * 并把该 frame 的全部版本作为一组传入，大图里可继续左右翻版本。
 */
export function ScreenshotSwiper({
	snapshots,
	leadingSkeleton,
}: {
	snapshots: Snapshot[];
	leadingSkeleton: boolean;
}) {
	const { t } = useTranslation();
	const group = snapshots.map((snapshot) => ({ id: snapshot.path, url: toVettaFileUrl(snapshot.path) }));

	return (
		<div className="py-1">
			<SwiperShell
				className="gap-2"
				prevLabel={t("card.screenshot.prev")}
				nextLabel={t("card.screenshot.next")}
				resetKey={`${snapshots.length}:${leadingSkeleton}`}
			>
				{leadingSkeleton && <CaptureSkeleton />}
				{group.map((ref) => (
					<button
						key={ref.id}
						type="button"
						title={t("card.screenshot.open")}
						onClick={() => getPluginCtx().ui.previewImage(ref, group)}
						className="shrink-0 overflow-hidden rounded-lg border border-border"
					>
						<img
							src={ref.url}
							alt={t("card.screenshot.title")}
							className={`block w-auto cursor-zoom-in object-contain ${ITEM_HEIGHT}`}
						/>
					</button>
				))}
			</SwiperShell>
		</div>
	);
}
