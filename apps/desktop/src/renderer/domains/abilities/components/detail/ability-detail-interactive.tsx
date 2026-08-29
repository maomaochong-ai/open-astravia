import type { AbilityFeatureItem, AbilityGalleryItem, AbilityStepItem, AbilityType } from "@shared/lib/api";
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@vetta/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AbilityIcon } from "../AbilityIcon";
import { DETAIL_FLOW, DetailChapterTitle } from "./ability-detail-surface";

function padIndex(index: number): string {
	return String(index + 1).padStart(2, "0");
}

/** 能力目录：并列主张，不是先后顺序，所以不编号。 */
export function FeatureInspector({
	title,
	items,
	abilityType,
}: {
	title?: string;
	items: AbilityFeatureItem[];
	abilityType: AbilityType;
}): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<section className="flex flex-col gap-4">
			<DetailChapterTitle>{title}</DetailChapterTitle>
			<div className={DETAIL_FLOW} data-detail-layout="catalog">
				{items.map((item, index) => (
					<article key={`${item.title}-${index}`} className="min-w-0">
						<div className="flex items-center gap-2">
							<AbilityIcon
								icon={item.icon}
								type={abilityType}
								className="h-7 w-7 rounded-lg border-transparent bg-transparent"
								iconClassName="h-3.5 w-3.5"
							/>
							<h3 className="text-[13px] font-medium text-foreground">{item.title}</h3>
						</div>
						<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
					</article>
				))}
			</div>
		</section>
	);
}

/** 步骤：从上到下的流程轨，序号和连线表达先后，不是能力清单。 */
export function StepWalkthrough({ title, items }: { title?: string; items: AbilityStepItem[] }): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<section className="flex flex-col gap-4">
			<DetailChapterTitle>{title}</DetailChapterTitle>
			<ol className="flex flex-col" data-detail-layout="sequence">
				{items.map((item, index) => {
					const last = index === items.length - 1;
					return (
						<li key={`${item.title}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4">
							<div className="flex flex-col items-center self-stretch">
								<span className="min-w-7 text-center text-[20px] font-semibold leading-none tabular-nums tracking-tight text-primary">
									{padIndex(index)}
								</span>
								{last ? null : <span className="mt-2 w-px flex-1 bg-border/40" aria-hidden />}
							</div>
							<div className={cn("min-w-0", last ? "pb-0" : "pb-7")}>
								<h3 className="text-[15px] font-semibold tracking-tight text-foreground">{item.title}</h3>
								{item.description ? (
									<p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
								) : null}
							</div>
						</li>
					);
				})}
			</ol>
		</section>
	);
}

export function ImageLightbox({
	src,
	alt,
	caption,
}: {
	src: string;
	alt?: string;
	caption?: string;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const [open, setOpen] = useState(false);
	const label = caption || alt || t("detail.story.previewImage");

	return (
		<>
			<button type="button" className="block w-full text-left" onClick={() => setOpen(true)}>
				<figure>
					<img src={src} alt={alt ?? ""} loading="lazy" decoding="async" className="h-auto w-full object-contain" />
					{caption ? <figcaption className="mt-2 text-[11px] text-muted-foreground">{caption}</figcaption> : null}
				</figure>
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-3xl p-3">
					<DialogTitle className="sr-only">{label}</DialogTitle>
					<DialogDescription className="sr-only">{t("detail.story.closePreview")}</DialogDescription>
					<img src={src} alt={alt ?? ""} className="h-auto max-h-[80vh] w-full object-contain" />
				</DialogContent>
			</Dialog>
		</>
	);
}

/** 画廊：每张图都在，点开只是放大，不藏内容。 */
export function GalleryTheater({ title, items }: { title?: string; items: AbilityGalleryItem[] }): JSX.Element | null {
	const { t } = useTranslation("abilities");
	const [open, setOpen] = useState<number | null>(null);
	if (items.length === 0) return null;
	const preview = open === null ? null : items[open];

	return (
		<section className="flex flex-col gap-4">
			<DetailChapterTitle>{title}</DetailChapterTitle>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
				{items.map((item, index) => (
					<button
						key={`${item.src}-${index}`}
						type="button"
						className="min-w-0 text-left"
						onClick={() => setOpen(index)}
					>
						<figure>
							<img
								src={item.src}
								alt={item.alt ?? ""}
								loading="lazy"
								decoding="async"
								className={cn("h-auto w-full object-cover", items.length === 1 ? "aspect-[2/1]" : "aspect-video")}
							/>
							{item.caption ? (
								<figcaption className="mt-2 text-[11px] text-muted-foreground">{item.caption}</figcaption>
							) : null}
						</figure>
					</button>
				))}
			</div>
			<Dialog open={preview !== null} onOpenChange={(next) => !next && setOpen(null)}>
				<DialogContent className="max-w-3xl p-3">
					<DialogTitle className="sr-only">
						{preview?.caption || preview?.alt || t("detail.story.previewImage")}
					</DialogTitle>
					<DialogDescription className="sr-only">{t("detail.story.closePreview")}</DialogDescription>
					{preview ? (
						<img src={preview.src} alt={preview.alt ?? ""} className="h-auto max-h-[80vh] w-full object-contain" />
					) : null}
				</DialogContent>
			</Dialog>
		</section>
	);
}
