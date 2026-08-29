import type {
	AbilityComparisonColumn,
	AbilityDetailBlock,
	AbilityGalleryItem,
	AbilityStatItem,
} from "@shared/lib/api";
import { cn } from "@vetta/ui";
import type { ReactNode } from "react";
import { DETAIL_CARD, DETAIL_CARD_INTERACTIVE, DETAIL_SECTION_TITLE } from "./ability-detail-surface";

export function AbilityDetailHero({ block }: { block: Extract<AbilityDetailBlock, { type: "hero" }> }): JSX.Element {
	const stacked = block.layout === "stacked";
	return (
		<section
			aria-label={block.title}
			className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/40 p-5"
		>
			<div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-background/10 to-background/80" />
			<div
				className={cn(
					"relative flex items-center gap-5",
					stacked ? "flex-col text-center" : "flex-col sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(150px,0.9fr)]",
				)}
			>
				<div className={cn("min-w-0", stacked && "flex flex-col items-center")}>
					{block.eyebrow ? (
						<p className="text-[11px] font-medium uppercase tracking-wide text-primary">{block.eyebrow}</p>
					) : null}
					<h2 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">{block.title}</h2>
					{block.description ? (
						<p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">{block.description}</p>
					) : null}
					{block.badges?.length ? (
						<div className="mt-3 flex flex-wrap gap-1.5">
							{block.badges.map((badge, index) => (
								<span
									key={`${badge}-${index}`}
									className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
								>
									{badge}
								</span>
							))}
						</div>
					) : null}
				</div>
				{block.image ? (
					<div className={cn(DETAIL_CARD, "flex min-h-28 items-center justify-center p-4")}>
						<img
							src={block.image}
							alt={block.image_alt ?? ""}
							loading="lazy"
							decoding="async"
							className="max-h-32 w-full object-contain"
						/>
					</div>
				) : null}
			</div>
		</section>
	);
}

function DetailSection({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
	return (
		<section className="flex flex-col gap-3">
			{title ? <h2 className={DETAIL_SECTION_TITLE}>{title}</h2> : null}
			{children}
		</section>
	);
}

function GalleryItem({ item }: { item: AbilityGalleryItem }): JSX.Element {
	return (
		<figure className={cn(DETAIL_CARD_INTERACTIVE, "overflow-hidden")}>
			<img
				src={item.src}
				alt={item.alt ?? ""}
				loading="lazy"
				decoding="async"
				className="aspect-video h-auto w-full object-cover"
			/>
			{item.caption ? (
				<figcaption className="border-t border-border/50 px-3.5 py-2 text-[11px] text-muted-foreground">
					{item.caption}
				</figcaption>
			) : null}
		</figure>
	);
}

export function AbilityDetailGallery({ block }: { block: Extract<AbilityDetailBlock, { type: "gallery" }> }): JSX.Element {
	return (
		<DetailSection title={block.title}>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
				{block.items.map((item, index) => (
					<GalleryItem key={`${item.src}-${index}`} item={item} />
				))}
			</div>
		</DetailSection>
	);
}

function StatCard({ item }: { item: AbilityStatItem }): JSX.Element {
	return (
		<div className={cn(DETAIL_CARD_INTERACTIVE, "px-3.5 py-3")}>
			<p className="text-[20px] font-semibold tracking-tight text-primary">{item.value}</p>
			<p className="mt-1 text-[13px] font-medium text-foreground">{item.label}</p>
			{item.description ? <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.description}</p> : null}
		</div>
	);
}

export function AbilityDetailStats({ block }: { block: Extract<AbilityDetailBlock, { type: "stats" }> }): JSX.Element {
	return (
		<DetailSection title={block.title}>
			<div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
				{block.items.map((item, index) => (
					<StatCard key={`${item.label}-${index}`} item={item} />
				))}
			</div>
		</DetailSection>
	);
}

function ComparisonCard({ column }: { column: AbilityComparisonColumn }): JSX.Element {
	const accent = column.tone === "accent";
	return (
		<div className={cn(accent ? "rounded-xl border border-primary/40 bg-primary/5 p-4" : cn(DETAIL_CARD, "p-4"))}>
			<h3 className="text-[13px] font-semibold text-foreground">{column.title}</h3>
			<ul className="mt-3 flex flex-col gap-2">
				{column.items.map((item, index) => (
					<li key={`${item}-${index}`} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
						<span
							className={cn(
								"mt-0.5 h-3.5 w-3.5 shrink-0",
								accent
									? "icon-[solar--check-circle-linear] text-primary"
									: "icon-[solar--minus-circle-linear] text-muted-foreground/60",
							)}
							aria-hidden
						/>
						{item}
					</li>
				))}
			</ul>
		</div>
	);
}

export function AbilityDetailComparison({ block }: { block: Extract<AbilityDetailBlock, { type: "comparison" }> }): JSX.Element {
	return (
		<DetailSection title={block.title}>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<ComparisonCard column={block.left} />
				<ComparisonCard column={block.right} />
			</div>
		</DetailSection>
	);
}
