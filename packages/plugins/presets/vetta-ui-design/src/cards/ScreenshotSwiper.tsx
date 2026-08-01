import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import { getPluginCtx } from "../plugin-context";
import type { Snapshot } from "./snapshots";

/** Thumbnails are a fixed height; width follows the frame's real aspect ratio. */
const ITEM_HEIGHT = "h-48";

/** Static file protocol URL (ADR-0027). */
function fileUrl(path: string): string {
	return `vetta-file://local${encodeURI(path)}`;
}

function Chevron({ dir }: { dir: "left" | "right" }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className="h-4 w-4"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
		</svg>
	);
}

/** 两端渐隐遮罩：提示该侧还有更多截图可滚动。 */
function EdgeFade({ dir }: { dir: "left" | "right" }) {
	return (
		<div
			aria-hidden
			className={`pointer-events-none absolute inset-y-0 z-[5] w-10 ${dir === "left" ? "left-0" : "right-0"}`}
			style={{ background: `linear-gradient(to ${dir === "left" ? "right" : "left"}, var(--background), transparent)` }}
		/>
	);
}

function ArrowButton({ dir, visible, onClick }: { dir: "left" | "right"; visible: boolean; onClick: () => void }) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onClick}
			title={dir === "left" ? t("card.screenshot.prev") : t("card.screenshot.next")}
			className={`absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/90 backdrop-blur-md transition-all hover:text-white ${dir === "left" ? "left-0" : "right-0"}`}
			style={{
				background: "color-mix(in oklab, black 48%, transparent)",
				opacity: visible ? 1 : 0,
				pointerEvents: visible ? "auto" : "none",
			}}
		>
			<Chevron dir={dir} />
		</button>
	);
}

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
	const scrollRef = useRef<HTMLDivElement>(null);
	const [canPrev, setCanPrev] = useState(false);
	const [canNext, setCanNext] = useState(false);
	const [hover, setHover] = useState(false);

	const measure = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		setCanPrev(el.scrollLeft > 1);
		setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
	};

	// 版本集变化后重新测量，并把最新一版滚回视野最左。
	useEffect(() => {
		measure();
		scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
	}, [snapshots.length, leadingSkeleton]);

	useEffect(() => {
		const onResize = (): void => measure();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const scrollByView = (dir: -1 | 1): void => {
		const el = scrollRef.current;
		if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
	};

	const group = snapshots.map((snapshot) => ({ id: snapshot.path, url: fileUrl(snapshot.path) }));

	return (
		<div className="relative py-1" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
			<div ref={scrollRef} onScroll={measure} className="vetd-shot-swiper flex gap-2 overflow-x-auto scroll-smooth">
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
							onLoad={measure}
							className={`block w-auto cursor-zoom-in object-contain ${ITEM_HEIGHT}`}
						/>
					</button>
				))}
			</div>
			{canPrev && (
				<>
					<EdgeFade dir="left" />
					<ArrowButton dir="left" visible={hover} onClick={() => scrollByView(-1)} />
				</>
			)}
			{canNext && (
				<>
					<EdgeFade dir="right" />
					<ArrowButton dir="right" visible={hover} onClick={() => scrollByView(1)} />
				</>
			)}
		</div>
	);
}
