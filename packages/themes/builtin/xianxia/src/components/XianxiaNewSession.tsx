import { cn } from "@astravia-org/ui";
import { useThemeSurface } from "@astravia-org/theme-sdk";
import type {
	NewSessionSkillBadgeRowProps,
	NewSessionSkillItem,
} from "@astravia-org/theme-ui";
import { ThemeSurface, useHorizontalDragScroll } from "@astravia-org/theme-ui";
import type { JSX } from "react";
import { xianxiaAssets } from "../assets";

const skillIcons = [
	xianxiaAssets.newSessionSkillBlade,
	xianxiaAssets.newSessionSkillCultivation,
	xianxiaAssets.newSessionSkillTimepiece,
	xianxiaAssets.newSessionSkillSeal,
] as const;

function iconByIndex(icons: readonly string[], index: number): string {
	return icons[index % icons.length] ?? icons[0] ?? "";
}

function scrollMaskClass(canPrev: boolean, canNext: boolean): string | undefined {
	if (canPrev && canNext) return "xianxia-scroll-mask-both";
	if (canPrev) return "xianxia-scroll-mask-left";
	if (canNext) return "xianxia-scroll-mask-right";
	return undefined;
}

export function XianxiaSkillBadgeRow({
	className,
	labels,
	onSelect,
	selected,
	skills,
	...props
}: NewSessionSkillBadgeRowProps): JSX.Element {
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
	} = useHorizontalDragScroll({ itemCount: skills.length, pageFactor: 0.85 });

	return (
		<div className={cn("group relative mt-4 w-[80%]", className)} {...props}>
			<div
				ref={scrollRef}
				onScroll={onScroll}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerCancel}
				onLostPointerCapture={onLostPointerCapture}
				className={cn(
					"no-scrollbar flex items-center gap-2 overflow-x-auto px-1 py-1.5 select-none touch-pan-y",
					scrollMaskClass(canPrev, canNext),
				)}
			>
				{skills.map((skill, index) => (
					<XianxiaSkillBadge
						key={skill.name}
						active={selected?.name === skill.name && selected?.type === "skill"}
						icon={iconByIndex(skillIcons, index)}
						item={skill}
						onClick={() => {
							if (shouldSuppressClick()) return;
							onSelect(skill);
						}}
					/>
				))}
			</div>
			<XianxiaScrollButton
				direction="prev"
				label={labels.scrollLeft}
				onClick={() => scrollByPage(-1)}
				visible={canPrev}
			/>
			<XianxiaScrollButton
				direction="next"
				label={labels.scrollRight}
				onClick={() => scrollByPage(1)}
				visible={canNext}
			/>
		</div>
	);
}

function XianxiaSkillBadge({
	active,
	icon,
	item,
	onClick,
}: {
	readonly active: boolean;
	readonly icon: string;
	readonly item: NewSessionSkillItem;
	readonly onClick: () => void;
}): JSX.Element {
	const surface = useThemeSurface("chat.newSessionSkillCard");

	return (
		<button
			type="button"
			onClick={onClick}
			title={item.description || item.name}
			className={cn(
				"relative inline-flex h-9 shrink-0 items-center overflow-visible rounded-full border text-[11px] font-medium transition-colors",
				active
					? "border-primary/50 bg-primary/10 text-primary"
					: "border-border/50 bg-card/55 text-muted-foreground hover:border-primary/40 hover:bg-card/80 hover:text-primary",
				surface?.rootClassName,
			)}
			data-theme-surface-root="chat.newSessionSkillCard"
		>
			<ThemeSurface slot="chat.newSessionSkillCard" />
			<span className="relative z-10 flex items-center gap-1.5 overflow-hidden rounded-[inherit] px-2.5 pr-3">
				<img alt="" aria-hidden="true" className="h-6 w-6 shrink-0 object-contain" src={icon} />
				<span>{item.alias || item.name}</span>
			</span>
		</button>
	);
}

function XianxiaScrollButton({
	direction,
	label,
	onClick,
	visible,
}: {
	readonly direction: "next" | "prev";
	readonly label: string;
	readonly onClick: () => void;
	readonly visible: boolean;
}): JSX.Element | null {
	if (!visible) return null;

	return (
		<button
			type="button"
			aria-label={label}
			onClick={onClick}
			title={label}
			className={cn(
				"absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:border-primary/40 hover:text-primary",
				direction === "prev" ? "-left-3" : "-right-3",
			)}
		>
			{direction === "prev" ? (
				<span className="icon-[mdi--chevron-left] h-4 w-4" />
			) : (
				<span className="icon-[mdi--chevron-right] h-4 w-4" />
			)}
		</button>
	);
}
