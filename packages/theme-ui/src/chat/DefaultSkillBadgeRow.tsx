import type { JSX } from "react";
import { motion } from "motion/react";
import { useThemeComponent } from "@vetta/theme-sdk";
import { cn } from "@vetta/ui";
import type { NewSessionSkillBadgeRowProps } from "./NewSession";
import { SkillCard } from "./SkillCard";
import { useHorizontalDragScroll } from "./useHorizontalDragScroll";

/** 技能徽章行高度占位（与加载中预留槽对齐）。 */
export const NEW_SESSION_SKILL_BADGE_SLOT_MIN_H_CLASS = "min-h-9";

/**
 * Skill pill row with horizontal scroll, pointer drag, and edge arrows.
 * No enter animation (sits above input bar).
 */
export function DefaultSkillBadgeRow({
	className,
	labels,
	skills,
	selected,
	onSelect,
	...props
}: NewSessionSkillBadgeRowProps): JSX.Element {
	const ThemedSkillCard = useThemeComponent("chat.newSessionSkillCard", SkillCard);
	const {
		canNext,
		canPrev,
		onLostPointerCapture,
		onPointerCancel,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onScroll,
		scrollByPage,
		scrollRef,
		shouldSuppressClick,
	} = useHorizontalDragScroll({ itemCount: skills.length });

	return (
		<div className={cn("group relative mt-4 w-full", className)} {...props}>
			<div
				ref={scrollRef}
				onScroll={onScroll}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerCancel}
				onLostPointerCapture={onLostPointerCapture}
				className={cn(
					"no-scrollbar flex items-center gap-1.5 overflow-x-auto px-1 py-1 select-none touch-pan-y",
					NEW_SESSION_SKILL_BADGE_SLOT_MIN_H_CLASS,
				)}
			>
				{skills.map((s) => {
					const active = selected?.name === s.name && selected?.type === "skill";
					return (
						<ThemedSkillCard
							key={s.name}
							active={active}
							item={s}
							onClick={() => {
								if (shouldSuppressClick()) return;
								onSelect(s);
							}}
							title={s.description || s.name}
						/>
					);
				})}
			</div>

			{canPrev && (
				<>
					<div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent" />
					<motion.button
						type="button"
						onClick={() => scrollByPage(-1)}
						whileHover={{ scale: 1.08 }}
						whileTap={{ scale: 0.92 }}
						className="absolute -left-3 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 hover:border-primary/40 hover:text-primary"
						title={labels.scrollLeft}
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
						onClick={() => scrollByPage(1)}
						whileHover={{ scale: 1.08 }}
						whileTap={{ scale: 0.92 }}
						className="absolute -right-3 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 hover:border-primary/40 hover:text-primary"
						title={labels.scrollRight}
					>
						<span className="icon-[mdi--chevron-right] h-4 w-4" />
					</motion.button>
				</>
			)}
		</div>
	);
}
