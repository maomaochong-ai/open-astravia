import { cn } from "@vetta/ui";
import { useThemeSurface } from "@vetta/theme-sdk";
import type {
	NewSessionSceneCarouselProps,
	NewSessionSceneItem,
	NewSessionSkillBadgeRowProps,
	NewSessionSkillItem,
} from "@vetta/theme-ui";
import { ThemeSurface, useHorizontalDragScroll } from "@vetta/theme-ui";
import type { JSX } from "react";
import { xianxiaAssets } from "../assets";

const sceneIcons = [
	xianxiaAssets.newSessionSceneShield,
	xianxiaAssets.newSessionSceneScroll,
	xianxiaAssets.newSessionSceneCompass,
] as const;

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
		dragging,
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
					dragging ? "cursor-grabbing" : "cursor-grab",
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

export function XianxiaSceneCarousel({
	actions,
	className,
	labels,
	onSceneClick,
	scenes,
	selected,
	...props
}: NewSessionSceneCarouselProps): JSX.Element {
	const {
		canNext,
		canPrev,
		dragging,
		onLostPointerCapture,
		onPointerCancel,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onScroll,
		scrollByPage,
		scrollRef,
		shouldSuppressClick,
	} = useHorizontalDragScroll({ itemCount: scenes.length, pageFactor: 0.85 });

	return (
		<div className={cn("group relative mt-6 w-[70%]", className)} {...props}>
			<div
				ref={scrollRef}
				onScroll={onScroll}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerCancel}
				onLostPointerCapture={onLostPointerCapture}
				className={cn(
					"no-scrollbar flex min-h-[5.75rem] snap-x snap-mandatory gap-2.5 overflow-x-auto py-1 select-none touch-pan-y",
					dragging ? "cursor-grabbing" : "cursor-grab",
					scrollMaskClass(canPrev, canNext),
				)}
			>
				{scenes.map((scene, index) => (
					<XianxiaSceneCard
						key={scene.name}
						action={actions[scene.name] ?? "idle"}
						icon={iconByIndex(sceneIcons, index)}
						item={scene}
						onClick={() => {
							if (shouldSuppressClick()) return;
							onSceneClick(scene);
						}}
						selected={selected?.name === scene.name && selected?.type === "scene"}
						title={scene.state === "uninstalled" ? labels.installPrompt : scene.description || scene.name}
					/>
				))}
			</div>
			<XianxiaScrollButton
				direction="prev"
				label={labels.previous}
				onClick={() => scrollByPage(-1)}
				visible={canPrev}
			/>
			<XianxiaScrollButton
				direction="next"
				label={labels.next}
				onClick={() => scrollByPage(1)}
				visible={canNext}
			/>
		</div>
	);
}

function XianxiaSceneCard({
	action,
	icon,
	item,
	onClick,
	selected,
	title,
}: {
	readonly action: "idle" | "loading" | "error";
	readonly icon: string;
	readonly item: NewSessionSceneItem;
	readonly onClick: () => void;
	readonly selected: boolean;
	readonly title: string;
}): JSX.Element {
	const muted = item.state !== "active";
	const selectedActive = item.state === "active" && selected;
	const surface = useThemeSurface("chat.newSessionSceneCard");

	return (
		<button
			type="button"
			disabled={action === "loading"}
			onClick={onClick}
			title={title}
			className={cn(
				"relative min-w-0 w-[30%] shrink-0 snap-start overflow-visible rounded-xl border text-left transition-colors disabled:cursor-wait",
				selectedActive
					? "border-primary/60 bg-primary/10"
					: muted
						? "border-dashed border-border/50 bg-card/45 hover:border-primary/40"
						: "border-border/55 bg-card/55 hover:border-primary/40 hover:bg-card/80",
				surface?.rootClassName,
			)}
			data-theme-surface-root="chat.newSessionSceneCard"
		>
			<ThemeSurface slot="chat.newSessionSceneCard" />
			<span className="relative z-10 flex min-w-0 items-start gap-2.5 overflow-hidden rounded-[inherit] px-3 py-2.5">
				<img alt="" aria-hidden="true" className="mt-0.5 h-8 w-8 shrink-0 object-contain" src={icon} />
				<span className="block min-w-0 flex-1 overflow-hidden">
					<span className="flex min-w-0 items-center gap-1.5">
						<span
							className={cn(
								"truncate text-[13px] font-semibold",
								muted ? "text-muted-foreground" : "text-foreground",
							)}
						>
							{item.alias || item.name}
						</span>
						<XianxiaSceneStatus action={action} muted={muted} selectedActive={selectedActive} />
					</span>
					{item.description && (
						<span className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70">
							{item.description}
						</span>
					)}
					{(item.version || (item.downloadCount ?? 0) > 0) && (
						<span className="mt-1.5 flex items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground/60">
							{item.version && (
								<span className="inline-flex h-4 items-center rounded-full bg-accent/50 px-1.5 font-medium">
									v{item.version}
								</span>
							)}
							{(item.downloadCount ?? 0) > 0 && (
								<span className="inline-flex h-4 items-center gap-0.5 rounded-full bg-accent/50 px-1.5 font-medium">
									<span className="icon-[solar--download-linear] h-2.5 w-2.5" />
									{item.downloadCount}
								</span>
							)}
						</span>
					)}
				</span>
			</span>
		</button>
	);
}

function XianxiaSceneStatus({
	action,
	muted,
	selectedActive,
}: {
	readonly action: "idle" | "loading" | "error";
	readonly muted: boolean;
	readonly selectedActive: boolean;
}): JSX.Element | null {
	if (action === "loading") {
		return <span className="icon-[solar--refresh-linear] h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
	}
	if (action === "error") {
		return <span className="icon-[solar--danger-circle-linear] h-3.5 w-3.5 shrink-0 text-destructive" />;
	}
	if (muted) {
		return <span className="icon-[solar--download-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />;
	}
	if (selectedActive) {
		return <span className="icon-[solar--check-circle-linear] h-3.5 w-3.5 shrink-0 text-primary" />;
	}
	return null;
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
