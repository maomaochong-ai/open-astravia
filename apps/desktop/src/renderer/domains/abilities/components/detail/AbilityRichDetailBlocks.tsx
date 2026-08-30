import type { AbilityComparisonColumn, AbilityDetailBlock } from "@shared/lib/api";
import { cn } from "@vetta/ui";
import type { ReactNode } from "react";
import { GalleryTheater } from "./ability-detail-interactive";
import { DetailChapterTitle } from "./ability-detail-surface";

const LOGO_BASENAME = /^(icon|logo)\.(png|jpe?g|webp|gif|svg)$/i;

function resourceBasename(value: string): string {
	const normalized = value.trim().replace(/\\/g, "/");
	try {
		const path = new URL(normalized, "https://vetta.local/").pathname;
		return (path.split("/").pop() ?? normalized).split("?")[0]?.toLowerCase() ?? "";
	} catch {
		return (normalized.split("/").pop() ?? normalized).split("?")[0]?.toLowerCase() ?? "";
	}
}

/** 封面只接受场景静帧；插件 Logo / 与页头同一张图都不画。 */
export function shouldShowHeroStill(image: string | undefined, abilityIcon?: string): boolean {
	if (!image?.trim()) return false;
	const imageName = resourceBasename(image);
	if (!imageName || LOGO_BASENAME.test(imageName)) return false;
	if (!abilityIcon?.trim()) return true;
	return image !== abilityIcon && imageName !== resourceBasename(abilityIcon);
}

/** 封面承诺：侧线引言，不是第二套页头。 */
export function AbilityDetailHero({
	block,
	abilityIcon,
}: {
	block: Extract<AbilityDetailBlock, { type: "hero" }>;
	abilityIcon?: string;
}): JSX.Element {
	const showStill = shouldShowHeroStill(block.image, abilityIcon);
	const still = showStill && block.image ? (
		<img
			src={block.image}
			alt={block.image_alt ?? ""}
			loading="lazy"
			decoding="async"
			className="max-h-44 w-auto max-w-full object-contain"
		/>
	) : null;
	const split = block.layout === "split" && still !== null;

	return (
		<section aria-label={block.title} className="relative" data-detail-layout="cover">
			<div
				className="pointer-events-none absolute -left-10 -top-12 h-36 w-36 rounded-full blur-3xl"
				style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}
				aria-hidden
			/>
			<div className={cn("relative", split && "grid items-end gap-8 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]")}>
				<div className="min-w-0 max-w-2xl border-l border-primary/40 pl-4">
					{block.eyebrow ? (
						<p className="text-[11px] font-medium uppercase tracking-wide text-primary">{block.eyebrow}</p>
					) : null}
					<h2 className={cn("text-[20px] font-semibold leading-snug tracking-tight text-foreground", block.eyebrow && "mt-2")}>
						{block.title}
					</h2>
					{block.description ? (
						<p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{block.description}</p>
					) : null}
					{block.badges?.length ? (
						<p className="mt-4 text-[11px] text-muted-foreground">
							{block.badges.map((badge, index) => (
								<span key={`${badge}-${index}`}>
									{index > 0 ? <span className="mx-2 text-muted-foreground/30">·</span> : null}
									<span className="text-primary">{badge}</span>
								</span>
							))}
						</p>
					) : null}
				</div>
				{still ? <div className={cn(split ? "justify-self-end" : "mt-6")}>{still}</div> : null}
			</div>
		</section>
	);
}

function DetailSection({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
	return (
		<section className="flex flex-col gap-4">
			<DetailChapterTitle>{title}</DetailChapterTitle>
			{children}
		</section>
	);
}

export function AbilityDetailGallery({ block }: { block: Extract<AbilityDetailBlock, { type: "gallery" }> }): JSX.Element {
	return <GalleryTheater title={block.title} items={block.items} />;
}

/** 度量行：色块里的值是控件，右边是标签，不是印刷校样。 */
export function AbilityDetailStats({ block }: { block: Extract<AbilityDetailBlock, { type: "stats" }> }): JSX.Element | null {
	if (block.items.length === 0) return null;
	return (
		<DetailSection title={block.title}>
			<div className="flex flex-wrap gap-x-6 gap-y-5" data-detail-layout="claims">
				{block.items.map((item, index) => {
					const compact = item.value.trim().length <= 4;
					return (
						<article
							key={`${item.label}-${index}`}
							className="flex min-w-0 max-w-[20rem] flex-1 basis-[16rem] gap-3.5"
						>
							<div className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 px-2.5">
								<p
									className={cn(
										"font-semibold leading-none tracking-tight text-primary tabular-nums",
										compact ? "text-[20px]" : "text-[15px]",
									)}
								>
									{item.value}
								</p>
							</div>
							<div className="min-w-0 pt-0.5">
								<p className="text-[13px] font-medium tracking-tight text-foreground">{item.label}</p>
								{item.description ? (
									<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
								) : null}
							</div>
						</article>
					);
				})}
			</div>
		</DetailSection>
	);
}

function resolveColumnTone(column: AbilityComparisonColumn, fallback: "neutral" | "accent"): "neutral" | "accent" {
	return column.tone ?? fallback;
}

function ComparisonPane({
	column,
	side,
	tone,
}: {
	column: AbilityComparisonColumn;
	side: "left" | "right";
	tone: "neutral" | "accent";
}): JSX.Element {
	const accent = tone === "accent";
	return (
		<div
			className={cn("relative min-w-0", accent && "rounded-xl bg-primary/10 p-4 ring-1 ring-inset ring-primary/25")}
			data-contrast-pane={side}
			data-contrast-tone={tone}
		>
			{accent ? (
				<div
					className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full blur-3xl"
					style={{ background: "color-mix(in srgb, var(--primary) 16%, transparent)" }}
					aria-hidden
				/>
			) : null}
			<div className={cn("relative", !accent && "py-1")}>
				<h3
					className={cn(
						"tracking-tight",
						accent
							? "inline-flex max-w-full rounded-lg bg-primary/15 px-2.5 py-1 text-[13px] font-medium text-primary"
							: "text-[13px] font-medium text-muted-foreground",
					)}
				>
					{column.title}
				</h3>
				<ul className={cn("flex flex-col", accent ? "mt-3" : "mt-2")}>
					{column.items.map((item, index) => (
						<li
							key={`${item}-${index}`}
							className={cn(
								"flex items-start gap-2.5 py-2.5",
								index < column.items.length - 1 && (accent ? "border-b border-primary/15" : "border-b border-border/30"),
							)}
						>
							<span
								className={cn(
									"mt-0.5 h-4 w-4 shrink-0",
									accent
										? "icon-[solar--check-circle-linear] text-primary"
										: "icon-[solar--minus-circle-linear] text-muted-foreground/50",
								)}
								aria-hidden
							/>
							<span
								className={cn(
									"min-w-0 text-[13px] leading-relaxed",
									accent ? "text-foreground" : "text-muted-foreground",
								)}
							>
								{item}
							</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

/** 对照：未选列表对选中面板，按语气分形，不按行 zip。 */
export function AbilityDetailComparison({ block }: { block: Extract<AbilityDetailBlock, { type: "comparison" }> }): JSX.Element {
	const leftTone = resolveColumnTone(block.left, "neutral");
	const rightTone = resolveColumnTone(block.right, "accent");
	const sameTone = leftTone === rightTone;
	return (
		<DetailSection title={block.title}>
			<div
				className={cn(
					"grid max-w-3xl grid-cols-1 items-start gap-6 sm:gap-8",
					sameTone
						? "sm:grid-cols-2"
						: leftTone === "accent"
							? "sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)]"
							: "sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)]",
				)}
				data-detail-layout="contrast"
			>
				<ComparisonPane column={block.left} side="left" tone={leftTone} />
				<ComparisonPane column={block.right} side="right" tone={rightTone} />
			</div>
		</DetailSection>
	);
}
