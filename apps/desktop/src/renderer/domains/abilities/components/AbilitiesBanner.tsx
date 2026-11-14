import { Button } from "@astravia-org/ui";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AbilityBannerIcon } from "../types";
import { AbilityIcon } from "./AbilityIcon";

const easeOut = [0.22, 1, 0.36, 1] as const;
const MAX_SLIDES = 5;
const ROTATE_MS = 5000;

/** 市场尚未加载时的占位图标（solar 预设，与能力市场同风格）。 */
const FALLBACK_ICONS: AbilityBannerIcon[] = [
	{ id: "fallback:magic", type: "skill", icon: "solar:magic-stick-3-bold", title: "", description: "" },
	{ id: "fallback:chart", type: "skill", icon: "solar:chart-2-bold", title: "", description: "" },
	{ id: "fallback:code", type: "skill", icon: "solar:code-bold", title: "", description: "" },
	{ id: "fallback:widget", type: "plugin", title: "", description: "" },
	{ id: "fallback:mcp", type: "mcp", title: "", description: "" },
	{ id: "fallback:bundle", type: "bundle", title: "", description: "" },
];

/**
 * 图标星座：第 0 个是当前精选项（居中偏左、最大），其余围绕它错落分布。
 * [left%, top%, 尺寸px, 旋转角, 透明度]
 */
const SLOT_LAYOUT = [
	{ left: 30, top: 50, size: 100, rotate: -6, opacity: 1 },
	{ left: 66, top: 24, size: 64, rotate: 8, opacity: 0.95 },
	{ left: 76, top: 66, size: 74, rotate: -8, opacity: 0.95 },
	{ left: 52, top: 86, size: 50, rotate: 10, opacity: 0.85 },
	{ left: 9, top: 16, size: 46, rotate: -10, opacity: 0.8 },
	{ left: 9, top: 84, size: 40, rotate: 6, opacity: 0.7 },
] as const;

/** 每张幻灯片一组主色（色相），背景渐变随之切换。 */
const SLIDE_HUES = [255, 335, 165, 28, 205] as const;

function slideGradient(hue: number): string {
	return `linear-gradient(135deg, hsl(${hue} 85% 58% / 0.55) 0%, hsl(${(hue + 45) % 360} 85% 55% / 0.28) 55%, hsl(${(hue + 90) % 360} 80% 50% / 0.1) 100%)`;
}

function shuffleIcons(icons: AbilityBannerIcon[]): AbilityBannerIcon[] {
	const next = [...icons];
	for (let i = next.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const a = next[i];
		const b = next[j];
		if (a && b) {
			next[i] = b;
			next[j] = a;
		}
	}
	return next;
}

export function AbilitiesBanner({ icons }: { icons: AbilityBannerIcon[] }): JSX.Element {
	const { t } = useTranslation("abilities");
	const navigate = useNavigate();

	const isFallback = icons.length === 0;
	const pool = useMemo(() => shuffleIcons(isFallback ? FALLBACK_ICONS : icons), [icons, isFallback]);
	const slideCount = isFallback ? 1 : Math.min(MAX_SLIDES, pool.length);
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

	useEffect(() => {
		setActive(0);
	}, [pool]);

	useEffect(() => {
		if (slideCount <= 1 || paused) return;
		const timer = window.setInterval(() => setActive((value) => (value + 1) % slideCount), ROTATE_MS);
		return () => window.clearInterval(timer);
	}, [slideCount, paused, active]);

	const hue = SLIDE_HUES[active % SLIDE_HUES.length] ?? SLIDE_HUES[0];
	const featured = pool[active % pool.length] ?? FALLBACK_ICONS[0]!;
	const group = useMemo(() => SLOT_LAYOUT.map((_, index) => pool[(active + index) % pool.length] ?? featured), [active, pool, featured]);

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, ease: easeOut }}
			data-tour="capabilities-banner"
			ref={rootRef}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className="relative hidden h-[192px] min-[900px]:grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] overflow-hidden rounded-2xl border border-border/50 bg-card/40"
		>
			<div aria-hidden className="relative overflow-hidden">
				<AnimatePresence initial={false}>
					<motion.div
						key={`bg-${active}`}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.7, ease: "easeInOut" }}
						className="absolute inset-0 will-change-[opacity]"
						style={{ background: slideGradient(hue) }}
					/>
				</AnimatePresence>
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,hsl(0_0%_100%/0.18),transparent_55%)]" />
				{[160, 244, 336].map((size, index) => (
					<div
						key={size}
						className="absolute rounded-full border border-foreground/10"
						style={{
							width: size,
							height: size,
							left: "30%",
							top: "50%",
							transform: "translate(-50%, -50%)",
							opacity: 1 - index * 0.28,
						}}
					/>
				))}
				<AnimatePresence mode="popLayout" initial={false}>
					<motion.div
						key={active}
						initial={{ opacity: 0, scale: 0.94 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 1.04 }}
						transition={{ duration: 0.4, ease: easeOut }}
						className="absolute inset-0 will-change-[transform,opacity]"
					>
						{group.map((source, index) => {
							const layout = SLOT_LAYOUT[index]!;
							const isFeatured = index === 0;
							return (
								<div
									key={`${index}-${source.id}`}
									style={{
										left: `${layout.left}%`,
										top: `${layout.top}%`,
										width: layout.size,
										height: layout.size,
										opacity: layout.opacity,
										transform: `translate(-50%, -50%) rotate(${layout.rotate}deg)`,
									}}
									className={`absolute flex items-center justify-center rounded-[26%] border bg-card shadow-xl shadow-black/15 ${
										isFeatured ? "z-10 border-foreground/20 ring-4 ring-foreground/10" : "border-foreground/10"
									}`}
								>
									<div style={{ width: layout.size * 0.76, height: layout.size * 0.76 }}>
										<AbilityIcon
											icon={source.icon}
											type={source.type}
											className="h-full w-full rounded-xl border-0 bg-transparent text-foreground"
											iconClassName="h-3/4 w-3/4"
										/>
									</div>
								</div>
							);
						})}
					</motion.div>
				</AnimatePresence>
			</div>

			<div className="relative flex min-w-0 flex-col justify-center gap-1 px-6 py-5">
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={featured.id}
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -6 }}
						transition={{ duration: 0.25, ease: easeOut }}
						className="flex min-w-0 flex-col"
					>
						{isFallback ? (
							<>
								<p className="text-[20px] font-semibold tracking-tight text-foreground">{t("banner.title")}</p>
								<p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground/70">
									{t("banner.description")}
								</p>
							</>
						) : (
							<>
								<p className="text-[12px] text-muted-foreground/60">{t("banner.featured")}</p>
								<p className="mt-0.5 truncate text-[20px] font-semibold tracking-tight text-foreground">
									{featured.title}
								</p>
								<p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/70">
									{featured.description}
								</p>
								<div className="mt-3">
									<Button
										variant="primary"
										size="sm"
										onClick={() => void navigate({ to: "/abilities", search: { detail: featured.id } })}
									>
										{t("banner.details")}
									</Button>
								</div>
							</>
						)}
					</motion.div>
				</AnimatePresence>

				{slideCount > 1 && (
					<div className="absolute bottom-4 left-6 flex items-center gap-1.5">
						{Array.from({ length: slideCount }, (_, index) => (
							<button
								key={index}
								type="button"
								aria-label={t("banner.goTo", { n: index + 1 })}
								onClick={() => setActive(index)}
								className={`h-1.5 rounded-full transition-all ${
									index === active ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
								}`}
							/>
						))}
					</div>
				)}
			</div>
		</motion.div>
	);
}
