import type { AbilityDetailBlock, AbilityType } from "@shared/lib/api";
import { Button, cn } from "@vetta/ui";
import { AbilityIcon } from "../AbilityIcon";
import { DETAIL_CARD, DETAIL_CARD_INTERACTIVE, DETAIL_SECTION_TITLE } from "./ability-detail-surface";
import { AbilityMarkdownBody } from "./AbilityMarkdownBody";
import { AbilityShowcaseList } from "./AbilityShowcaseList";
import { AbilityDetailComparison, AbilityDetailGallery, AbilityDetailHero, AbilityDetailStats } from "./AbilityRichDetailBlocks";

const CALLOUT_TONE = {
	info: {
		frame: "border-primary/25 bg-primary/5",
		icon: "icon-[solar--info-circle-linear] text-primary",
	},
	success: {
		frame: "border-emerald-500/20 bg-emerald-500/15",
		icon: "icon-[solar--check-circle-linear] text-emerald-400",
	},
	warning: {
		frame: "border-amber-500/20 bg-amber-500/15",
		icon: "icon-[solar--danger-triangle-linear] text-amber-400",
	},
} as const;

function BlockTitle({ children }: { children: string | undefined }): JSX.Element | null {
	if (!children) return null;
	return <h2 className={DETAIL_SECTION_TITLE}>{children}</h2>;
}

function AbilityDetailBlockView({
	block,
	abilityType,
}: {
	block: AbilityDetailBlock;
	abilityType: AbilityType;
}): JSX.Element | null {
	if (block.type === "hero") return <AbilityDetailHero block={block} />;
	if (block.type === "feature-grid") {
		return (
			<section className="flex flex-col gap-3">
				<BlockTitle>{block.title}</BlockTitle>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
					{block.items.map((item, index) => (
						<div key={`${item.title}-${index}`} className={cn(DETAIL_CARD_INTERACTIVE, "flex min-w-0 gap-3 px-3.5 py-3")}>
							<AbilityIcon
								icon={item.icon}
								type={abilityType}
								className="h-9 w-9 rounded-lg border-primary/20 bg-primary/10 text-primary"
								iconClassName="h-4 w-4"
							/>
							<div className="min-w-0">
								<h3 className="text-[13px] font-medium text-foreground">{item.title}</h3>
								<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
							</div>
						</div>
					))}
				</div>
			</section>
		);
	}

	if (block.type === "steps") {
		return (
			<section className="flex flex-col gap-3">
				<BlockTitle>{block.title}</BlockTitle>
				<ol className={cn(DETAIL_CARD, "flex flex-col gap-0 overflow-hidden px-3.5 py-2")}>
					{block.items.map((item, index) => (
						<li key={`${item.title}-${index}`} className="relative flex gap-3 py-2.5">
							{index < block.items.length - 1 ? (
								<span className="absolute bottom-0 left-[11px] top-8 w-px bg-border" aria-hidden />
							) : null}
							<span className="relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-1 ring-inset ring-primary/20">
								{index + 1}
							</span>
							<div className="min-w-0 pt-0.5">
								<h3 className="text-[13px] font-medium text-foreground">{item.title}</h3>
								{item.description ? (
									<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{item.description}</p>
								) : null}
							</div>
						</li>
					))}
				</ol>
			</section>
		);
	}

	if (block.type === "showcase") {
		return <AbilityShowcaseList showcases={[block.showcase]} />;
	}

	if (block.type === "image") {
		return (
			<figure className={cn(DETAIL_CARD, "overflow-hidden")}>
				<img src={block.src} alt={block.alt ?? ""} loading="lazy" decoding="async" className="h-auto w-full object-contain" />
				{block.caption ? (
					<figcaption className="border-t border-border/50 px-3.5 py-2 text-[11px] text-muted-foreground">
						{block.caption}
					</figcaption>
				) : null}
			</figure>
		);
	}

	if (block.type === "gallery") return <AbilityDetailGallery block={block} />;
	if (block.type === "stats") return <AbilityDetailStats block={block} />;
	if (block.type === "comparison") return <AbilityDetailComparison block={block} />;

	if (block.type === "callout") {
		const tone = CALLOUT_TONE[block.tone];
		return (
			<aside className={cn("flex gap-3 rounded-xl border px-3.5 py-3", tone.frame)}>
				<span className={cn("mt-0.5 h-4 w-4 shrink-0", tone.icon)} aria-hidden />
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
				<BlockTitle>{block.title}</BlockTitle>
				<div className={cn(DETAIL_CARD, "flex flex-wrap gap-2 px-3.5 py-3")}>
					{block.items.map((item) => (
						<Button key={`${item.label}-${item.href}`} variant="secondary" size="sm" onClick={() => void window.vetta.shell.openExternal(item.href)}>
							{item.label}
							<span className="icon-[solar--arrow-right-up-linear] h-3.5 w-3.5" />
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
		<div className="flex flex-col gap-6">
			{blocks.map((block, index) => (
				<AbilityDetailBlockView key={`${block.type}-${index}`} block={block} abilityType={abilityType} />
			))}
		</div>
	);
}
