import type { AbilityDetailBlock } from "@shared/lib/api";
import { cn } from "@vetta/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GalleryTheater } from "./ability-detail-interactive";
import { DETAIL_FLOW, DETAIL_KICKER, DetailChapterTitle } from "./ability-detail-surface";

/** 封面承诺：侧线引言，而不是章节清单或右侧 Logo 栏。 */
export function AbilityDetailHero({ block }: { block: Extract<AbilityDetailBlock, { type: "hero" }> }): JSX.Element {
	const still = block.image ? (
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
				<div className="min-w-0 border-l border-primary/40 pl-4">
					{block.eyebrow ? (
						<p className="text-[11px] font-medium uppercase tracking-wide text-primary">{block.eyebrow}</p>
					) : null}
					<h2 className={cn("max-w-2xl text-[20px] font-semibold leading-snug tracking-tight text-foreground", block.eyebrow && "mt-2")}>
						{block.title}
					</h2>
					{block.description ? (
						<p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">{block.description}</p>
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

/** 主张条：数字本身是主角，短条目自动并排。 */
export function AbilityDetailStats({ block }: { block: Extract<AbilityDetailBlock, { type: "stats" }> }): JSX.Element | null {
	if (block.items.length === 0) return null;
	return (
		<DetailSection title={block.title}>
			<div className={DETAIL_FLOW} data-detail-layout="catalog">
				{block.items.map((item, index) => (
					<div key={`${item.label}-${index}`} className="min-w-0">
						<p className="text-[20px] font-semibold tracking-tight text-primary">{item.value}</p>
						<p className="mt-1 text-[13px] font-medium text-foreground">{item.label}</p>
						{item.description ? (
							<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
						) : null}
					</div>
				))}
			</div>
		</DetailSection>
	);
}

function zipComparisonRows(left: string[], right: string[]): Array<{ left?: string; right?: string }> {
	const count = Math.max(left.length, right.length);
	return Array.from({ length: count }, (_, index) => ({
		left: left[index],
		right: right[index],
	}));
}

/** 对照：同一行左右对读，中间是对照关系，不是两份并列清单。 */
export function AbilityDetailComparison({ block }: { block: Extract<AbilityDetailBlock, { type: "comparison" }> }): JSX.Element {
	const { t } = useTranslation("abilities");
	const leftAccent = block.left.tone === "accent";
	const rightAccent = block.right.tone === "accent";
	const rows = zipComparisonRows(block.left.items, block.right.items);

	return (
		<DetailSection title={block.title}>
			<table className="w-full border-collapse" data-detail-layout="contrast">
				<thead>
					<tr>
						<th
							scope="col"
							className={cn(DETAIL_KICKER, "pb-3 text-left font-medium", leftAccent && "text-primary")}
						>
							{block.left.title}
						</th>
						<th scope="col" className="w-12 pb-3 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground/50">
							{t("detail.story.vs")}
						</th>
						<th
							scope="col"
							className={cn(DETAIL_KICKER, "pb-3 text-left font-medium", rightAccent ? "text-primary" : undefined)}
						>
							{block.right.title}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={`${row.left ?? ""}-${row.right ?? ""}-${index}`} className="border-t border-border/40">
							<td className="py-3 pr-3 align-top text-[12px] leading-relaxed text-muted-foreground">{row.left}</td>
							<td className="px-1 py-3 text-center align-top">
								{row.left && row.right ? (
									<span className="icon-[solar--arrow-right-linear] inline-block h-3.5 w-3.5 text-muted-foreground/30" aria-hidden />
								) : null}
							</td>
							<td className="py-3 pl-3 align-top text-[12px] leading-relaxed text-foreground/90">{row.right}</td>
						</tr>
					))}
				</tbody>
			</table>
		</DetailSection>
	);
}
