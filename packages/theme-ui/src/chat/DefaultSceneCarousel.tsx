import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { motion } from "motion/react";
import { useThemeComponent } from "@vetta-org/theme-sdk";
import { cn } from "@vetta-org/ui";
import type { NewSessionSceneCarouselProps } from "./NewSession";
import { SceneCard } from "./SceneCard";

const easeOut = [0.16, 1, 0.3, 1] as const;

/** 场景卡常见高度（标题 + 两行描述 + meta）占位，与 DefaultNewSessionHero 预留槽对齐。 */
export const NEW_SESSION_SCENE_SLOT_MIN_H_CLASS = "min-h-[5.75rem]";

/**
 * Props-driven scene carousel (3 cards per view). Host resolves i18n labels.
 * Width follows outer left-aligned column (max-w-2xl); horizontal scroll + hover arrows.
 */
export function DefaultSceneCarousel({
	actions,
	className,
	labels,
	onSceneClick,
	scenes,
	selected,
	...props
}: NewSessionSceneCarouselProps): JSX.Element {
	const ThemedSceneCard = useThemeComponent("chat.newSessionSceneCard", SceneCard);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [canPrev, setCanPrev] = useState(false);
	const [canNext, setCanNext] = useState(false);

	const updateEdges = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		setCanPrev(el.scrollLeft > 1);
		setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
	}, []);

	useEffect(() => {
		updateEdges();
		const el = scrollRef.current;
		if (!el) return;
		const ro = new ResizeObserver(updateEdges);
		ro.observe(el);
		return () => ro.disconnect();
	}, [updateEdges, scenes.length]);

	const scrollByView = useCallback((dir: -1 | 1) => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
	}, []);

	return (
		<div className={cn("group relative mt-6 w-full", className)} {...props}>
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, delay: 0.25, ease: easeOut }}
			>
				<div
					ref={scrollRef}
					onScroll={updateEdges}
					className={`no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto py-1 ${NEW_SESSION_SCENE_SLOT_MIN_H_CLASS}`}
				>
					{scenes.map((s) => {
						const action = actions[s.name] ?? "idle";
						return (
							<ThemedSceneCard
								key={s.name}
								action={action}
								item={s}
								selected={selected?.name === s.name && selected?.type === "scene"}
								onClick={() => onSceneClick(s)}
								title={s.state === "uninstalled" ? labels.installPrompt : s.description || s.name}
							/>
						);
					})}
				</div>

				{canPrev && (
					<>
						<div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent" />
						<motion.button
							type="button"
							onClick={() => scrollByView(-1)}
							whileHover={{ scale: 1.08 }}
							whileTap={{ scale: 0.92 }}
							className="absolute -left-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 hover:border-primary/40 hover:text-primary"
							title={labels.previous}
						>
							<span className="icon-[mdi--chevron-left] h-4 w-4" />
						</motion.button>
					</>
				)}
				{canNext && (
					<>
						<div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
						<motion.button
							type="button"
							onClick={() => scrollByView(1)}
							whileHover={{ scale: 1.08 }}
							whileTap={{ scale: 0.92 }}
							className="absolute -right-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 hover:border-primary/40 hover:text-primary"
							title={labels.next}
						>
							<span className="icon-[mdi--chevron-right] h-4 w-4" />
						</motion.button>
					</>
				)}
			</motion.div>
		</div>
	);
}
