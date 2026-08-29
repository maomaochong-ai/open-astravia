import type { AbilityDetailBlock, AbilityType } from "@shared/lib/api";
import { Button, cn } from "@vetta/ui";
import { FeatureInspector, ImageLightbox, StepWalkthrough } from "./ability-detail-interactive";
import { DETAIL_RULE, DetailChapterTitle } from "./ability-detail-surface";
import { AbilityMarkdownBody } from "./AbilityMarkdownBody";
import { AbilityShowcaseList } from "./AbilityShowcaseList";
import { AbilityDetailComparison, AbilityDetailGallery, AbilityDetailHero, AbilityDetailStats } from "./AbilityRichDetailBlocks";

const CALLOUT_TONE = {
	info: {
		frame: "border-primary/40",
		iconWrap: "text-primary",
		icon: "icon-[solar--info-circle-linear]",
	},
	success: {
		frame: "border-emerald-500/40",
		iconWrap: "text-emerald-400",
		icon: "icon-[solar--check-circle-linear]",
	},
	warning: {
		frame: "border-amber-500/40",
		iconWrap: "text-amber-400",
		icon: "icon-[solar--danger-triangle-linear]",
	},
} as const;

function AbilityDetailBlockView({
	block,
	abilityType,
}: {
	block: AbilityDetailBlock;
	abilityType: AbilityType;
}): JSX.Element | null {
	if (block.type === "hero") return <AbilityDetailHero block={block} />;

	if (block.type === "feature-grid") {
		return <FeatureInspector title={block.title} items={block.items} abilityType={abilityType} />;
	}

	if (block.type === "steps") {
		return <StepWalkthrough title={block.title} items={block.items} />;
	}

	if (block.type === "showcase") {
		return <AbilityShowcaseList showcases={[block.showcase]} />;
	}

	if (block.type === "image") {
		return <ImageLightbox src={block.src} alt={block.alt} caption={block.caption} />;
	}

	if (block.type === "gallery") return <AbilityDetailGallery block={block} />;
	if (block.type === "stats") return <AbilityDetailStats block={block} />;
	if (block.type === "comparison") return <AbilityDetailComparison block={block} />;

	if (block.type === "callout") {
		const tone = CALLOUT_TONE[block.tone];
		return (
			<aside className={cn("flex gap-3 border-l px-0 py-1 pl-3", tone.frame)}>
				<span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center", tone.iconWrap)}>
					<span className={cn("h-4 w-4", tone.icon)} aria-hidden />
				</span>
				<div className="min-w-0">
					{block.title ? <h3 className="text-[13px] font-medium text-foreground">{block.title}</h3> : null}
					<p className={cn("whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground", block.title && "mt-1")}>
						{block.content}
					</p>
				</div>
			</aside>
		);
	}

	if (block.type === "markdown") {
		return <AbilityMarkdownBody content={block.content} />;
	}

	if (block.type === "links") {
		return (
			<section className="flex flex-col gap-3">
				<DetailChapterTitle>{block.title}</DetailChapterTitle>
				<div className="flex flex-col">
					{block.items.map((item, index) => (
						<Button
							key={`${item.label}-${item.href}`}
							variant="ghost"
							className={cn("h-auto w-full justify-between rounded-none px-0 py-3 text-[13px] font-medium", index > 0 && DETAIL_RULE)}
							onClick={() => void window.vetta.shell.openExternal(item.href)}
						>
							{item.label}
							<span className="icon-[solar--arrow-right-up-linear] h-3.5 w-3.5 text-muted-foreground" />
						</Button>
					))}
				</div>
			</section>
		);
	}

	return null;
}

/** 仓库声明数据、宿主决定组件：不接收 className、HTML、脚本或自定义操作。 */
export function AbilityDetailBlocks({
	blocks,
	abilityType,
}: {
	blocks: AbilityDetailBlock[];
	abilityType: AbilityType;
}): JSX.Element | null {
	if (blocks.length === 0) return null;
	return (
		<div className="flex flex-col gap-8">
			{blocks.map((block, index) => (
				<AbilityDetailBlockView key={`${block.type}-${index}`} block={block} abilityType={abilityType} />
			))}
		</div>
	);
}
