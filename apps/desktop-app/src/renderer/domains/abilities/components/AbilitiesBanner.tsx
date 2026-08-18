import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AbilityIcon } from "./AbilityIcon";
import type { AbilityBannerIcon } from "../types";

const easeOut = [0.22, 1, 0.36, 1] as const;
const SLOT_COUNT = 3;
const ROTATE_MS = 3200;

/** 市场尚未加载时的占位图标（solar 预设，与能力市场同风格）。 */
const FALLBACK_ICONS: AbilityBannerIcon[] = [
	{ id: "fallback:magic", type: "skill", icon: "solar:magic-stick-3-bold" },
	{ id: "fallback:chart", type: "skill", icon: "solar:chart-2-bold" },
	{ id: "fallback:code", type: "skill", icon: "solar:code-bold" },
	{ id: "fallback:widget", type: "plugin" },
	{ id: "fallback:mcp", type: "mcp" },
	{ id: "fallback:bundle", type: "bundle" },
];

const SLOT_LAYOUT = [
	{ className: "left-0 top-5 -rotate-[10deg] z-10" },
	{ className: "left-[52px] top-0 rotate-[4deg] z-30" },
	{ className: "left-[104px] top-6 rotate-[12deg] z-20" },
] as const;

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

	const pool = useMemo(() => shuffleIcons(icons.length > 0 ? icons : FALLBACK_ICONS), [icons]);
	const [offset, setOffset] = useState(0);

	useEffect(() => {
		setOffset(0);
		if (pool.length <= SLOT_COUNT) return;
		const timer = window.setInterval(() => setOffset((value) => value + 1), ROTATE_MS);
		return () => window.clearInterval(timer);
	}, [pool]);

	const slots = useMemo(
		() =>
			Array.from({ length: SLOT_COUNT }, (_, index) => {
				const source = pool[(offset + index) % pool.length] ?? FALLBACK_ICONS[index]!;
				return { slot: index, source };
			}),
		[offset, pool],
	);

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.45, ease: easeOut }}
			data-tour="capabilities-banner"
			className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/40"
		>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 via-primary/5 to-transparent"
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute -right-6 -top-10 h-36 w-36 rounded-full bg-primary/15 blur-3xl"
			/>

			<div className="relative flex items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5">
				<div className="min-w-0 flex-1">
					<p className="text-[15px] font-semibold tracking-tight text-foreground">{t("banner.title")}</p>
					<p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted-foreground/70">
						{t("banner.description")}
					</p>
				</div>

				<div aria-hidden className="relative h-[100px] w-[168px] shrink-0">
					<div className="absolute left-6 top-3 h-16 w-16 rounded-full bg-primary/10 blur-xl" />
					<div className="absolute right-0 top-8 h-12 w-12 rounded-full bg-primary/15 blur-lg" />

					{slots.map(({ slot, source }) => {
						const layout = SLOT_LAYOUT[slot]!;
						return (
							<div
								key={slot}
								className={`absolute flex h-14 w-14 items-center justify-center rounded-xl border border-border/50 bg-card/95 p-1.5 ring-1 ring-inset ring-border/40 backdrop-blur-sm ${layout.className}`}
							>
								<AnimatePresence mode="wait" initial={false}>
									<motion.div
										key={`${slot}-${source.id}-${offset}`}
										initial={{ opacity: 0, scale: 0.88 }}
										animate={{ opacity: 1, scale: 1 }}
										exit={{ opacity: 0, scale: 0.92 }}
										transition={{ duration: 0.28, ease: easeOut }}
										className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg"
									>
										<AbilityIcon
											icon={source.icon}
											type={source.type}
											className="h-full w-full rounded-lg border-0 bg-primary/10 text-primary"
										/>
									</motion.div>
								</AnimatePresence>
							</div>
						);
					})}
				</div>
			</div>
		</motion.div>
	);
}
