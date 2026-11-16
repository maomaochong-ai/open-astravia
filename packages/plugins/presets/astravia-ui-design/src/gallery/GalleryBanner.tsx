import { useTranslation } from "@astravia-org/plugin-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { DesignSystemPreview } from "../canvas/DesignSystemPreview";
import { designSystemTagline } from "../design-systems/labels";
import { useCatalogState } from "../design-systems/index";
import type { DesignSystem } from "../design-systems/types";

/**
 * 画廊顶部轮播：借能力页 `AbilitiesBanner` 的语法（图标星座 + 每张幻灯片一个色相 +
 * 推荐文案 + 主色按钮 + 短横轮播点），内容换成风格库——第 0 个精选项放大居中，其余按
 * 固定六格错落。瓷砖直接复用 `DesignSystemPreview`（用该风格的令牌画界面骨架），不另画一套。
 *
 * 5 秒一轮，悬停 / 失焦 / 滚出视口暂停，避免在看不见的地方持续出帧（与能力页同一停帧逻辑）。
 * 动画用纯 CSS（插件不引入 motion），背景渐变走 `transition: background`，瓷砖换张靠 key 重挂淡入。
 */

const ROTATE_MS = 5000;
const MAX_SLIDES = 5;

/** 每张幻灯片一组主色（色相），背景渐变随之切换。 */
const SLIDE_HUES = [255, 210, 232, 40, 12] as const;

/** 图标星座：第 0 个是当前精选项（居中偏左、最大），其余围绕它错落分布。[left%, top%, 尺寸px, 旋转角, 透明度] */
const SLOT_LAYOUT = [
	{ left: 30, top: 50, size: 100, rotate: -6, opacity: 1 },
	{ left: 66, top: 24, size: 64, rotate: 8, opacity: 0.95 },
	{ left: 76, top: 66, size: 74, rotate: -8, opacity: 0.95 },
	{ left: 52, top: 86, size: 50, rotate: 10, opacity: 0.85 },
	{ left: 9, top: 16, size: 46, rotate: -10, opacity: 0.8 },
	{ left: 9, top: 84, size: 40, rotate: 6, opacity: 0.7 },
] as const;

function slideGradient(hue: number): string {
	return `linear-gradient(135deg, hsl(${hue} 85% 58% / 0.55) 0%, hsl(${(hue + 45) % 360} 85% 55% / 0.28) 55%, hsl(${(hue + 90) % 360} 80% 50% / 0.1) 100%)`;
}

export interface GalleryBannerProps {
	/** 点「查看详情」的落点，与点风格卡一致（打开风格详情）。 */
	onPick: (system: DesignSystem) => void;
}

export function GalleryBanner({ onPick }: GalleryBannerProps) {
	const { t, locale } = useTranslation();
	const { systems } = useCatalogState();

	/** 推荐前 5 套风格；不足 5 套就全部，一套都没有时整块不渲染。 */
	const slides = useMemo(() => systems.slice(0, MAX_SLIDES), [systems]);
	const [active, setActive] = useState(0);
	const [hovered, setHovered] = useState(false);
	const [offscreen, setOffscreen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const paused = hovered || offscreen;

	// 窗口失焦、标签隐藏或 banner 滚出视口时停止轮播，避免在看不见的地方持续出帧。
	useEffect(() => {
		const node = rootRef.current;
		let visible = true;
		let focused = document.hasFocus() && !document.hidden;
		const sync = (): void => setOffscreen(!visible || !focused);
		const onState = (): void => {
			focused = document.hasFocus() && !document.hidden;
			sync();
		};
		const observer =
			node && typeof IntersectionObserver !== "undefined"
				? new IntersectionObserver(([entry]) => {
						visible = entry?.isIntersecting ?? true;
						sync();
					})
				: null;
		if (node) observer?.observe(node);
		window.addEventListener("focus", onState);
		window.addEventListener("blur", onState);
		document.addEventListener("visibilitychange", onState);
		return () => {
			observer?.disconnect();
			window.removeEventListener("focus", onState);
			window.removeEventListener("blur", onState);
			document.removeEventListener("visibilitychange", onState);
		};
	}, []);

	// 目录就绪后从第 0 张开始；换目录（刷新）也归位。
	useEffect(() => setActive(0), [slides.length]);

	useEffect(() => {
		if (slides.length <= 1 || paused) return;
		const timer = window.setInterval(() => setActive((value) => (value + 1) % slides.length), ROTATE_MS);
		return () => window.clearInterval(timer);
	}, [slides.length, paused, active]);

	if (slides.length === 0) return null;

	const hue = SLIDE_HUES[active % SLIDE_HUES.length] ?? SLIDE_HUES[0];
	const featured = slides[active % slides.length] ?? slides[0]!;
	const group = SLOT_LAYOUT.map((_, index) => slides[(active + index) % slides.length] ?? featured);
	const tagline = designSystemTagline(featured, locale, t);

	return (
		<div
			ref={rootRef}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className="relative mb-[30px] grid h-[200px] grid-cols-[minmax(0,1.02fr)_minmax(0,1fr)] overflow-hidden rounded-[18px] border border-border/50 bg-card/40"
		>
			<div aria-hidden className="relative overflow-hidden">
				{/* 背景渐变：色相切换用 CSS transition，不引入 motion。 */}
				<div
					className="absolute inset-0 transition-[background] duration-700"
					style={{ background: slideGradient(hue) }}
				/>
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_52%,hsl(0_0%_100%/0.18),transparent_56%)]" />
				{/* 瓷砖星座：换张靠 key 重挂 + CSS 淡入。 */}
				<div key={active} className="absolute inset-0 animate-[gallery-banner-in_0.4s_ease-out]">
					{group.map((system, index) => {
						const layout = SLOT_LAYOUT[index]!;
						const isFeatured = index === 0;
						return (
							<div
								key={`${index}-${system.id}`}
								style={{
									left: `${layout.left}%`,
									top: `${layout.top}%`,
									width: layout.size,
									height: layout.size,
									opacity: layout.opacity,
									transform: `translate(-50%, -50%) rotate(${layout.rotate}deg)`,
								}}
								className={`absolute flex items-center justify-center overflow-hidden rounded-[24%] border bg-card shadow-lg shadow-black/15 ${
									isFeatured ? "z-10 border-foreground/20 ring-4 ring-foreground/10" : "border-foreground/10"
								}`}
							>
								<DesignSystemPreview system={system} className="h-full w-full" />
							</div>
						);
					})}
				</div>
			</div>

			<div className="relative flex min-w-0 flex-col justify-center gap-1 px-6 py-5">
				<p className="text-[9.5px] uppercase tracking-[0.17em] text-muted-foreground/75">{t("gallery.banner.kicker")}</p>
				<p className="truncate text-2xl font-semibold tracking-tight text-foreground">{featured.name}</p>
				<p className="line-clamp-2 max-w-[340px] text-[12.5px] leading-relaxed text-muted-foreground/90">{tagline}</p>
				<button
					type="button"
					onClick={() => onPick(featured)}
					className="mt-1 h-[26px] w-fit rounded-lg bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
				>
					{t("gallery.banner.cta")}
				</button>

				{slides.length > 1 ? (
					<div className="absolute bottom-4 left-6 flex items-center gap-[5px]">
						{slides.map((system, index) => (
							<button
								key={system.id}
								type="button"
								aria-label={t("gallery.banner.goto", { n: index + 1 })}
								aria-current={index === active}
								onClick={() => setActive(index)}
								className={`h-[5px] rounded-full transition-all ${
									index === active ? "w-4 bg-primary" : "w-[5px] bg-muted-foreground/30 hover:bg-muted-foreground/50"
								}`}
							/>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}
