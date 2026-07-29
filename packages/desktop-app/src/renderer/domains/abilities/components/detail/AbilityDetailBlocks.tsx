import type { AbilityDetailBlock, AbilityType } from "@shared/lib/api";
import { Button, cn } from "@vetta/ui";
import { AbilityIcon } from "../AbilityIcon";
import { AbilityMarkdownBody } from "./AbilityMarkdownBody";
import { AbilityShowcaseList } from "./AbilityShowcaseList";

const CALLOUT_TONE_CLASS = {
	info: "border-border/60 bg-muted/45",
	success: "border-primary/25 bg-primary/5",
	warning: "border-border/70 bg-muted/70",
} as const;

function BlockTitle({ children }: { children: string | undefined }): JSX.Element | null {
	if (!children) return null;
	return <h2 className="text-[15px] font-semibold text-foreground">{children}</h2>;
}

function AbilityDetailBlockView({
	block,
	abilityType,
}: {
	block: AbilityDetailBlock;
	abilityType: AbilityType;
}): JSX.Element {
	if (block.type === "feature-grid") {
		return (
			<section className="flex flex-col gap-3">
				<BlockTitle>{block.title}</BlockTitle>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{block.items.map((item, index) => (
						<div
							key={`${item.title}-${index}`}
							className="flex min-w-0 gap-3 rounded-xl border border-border/55 bg-muted/25 p-4"
						>
							<AbilityIcon icon={item.icon} type={abilityType} className="h-9 w-9 rounded-lg" iconClassName="h-4 w-4" />
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
				<ol className="flex flex-col gap-3">
					{block.items.map((item, index) => (
						<li key={`${item.title}-${index}`} className="flex gap-3">
							<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
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
			<figure className="overflow-hidden rounded-xl border border-border/55 bg-muted/25">
				<img src={block.src} alt={block.alt ?? ""} loading="lazy" decoding="async" className="h-auto w-full object-contain" />
				{block.caption ? (
					<figcaption className="border-t border-border/45 px-3 py-2 text-[11px] text-muted-foreground">
						{block.caption}
					</figcaption>
				) : null}
			</figure>
		);
	}

	if (block.type === "callout") {
		return (
			<aside className={cn("rounded-xl border px-4 py-3", CALLOUT_TONE_CLASS[block.tone])}>
				{block.title ? <h3 className="text-[13px] font-medium text-foreground">{block.title}</h3> : null}
				<p className={cn("whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground", block.title && "mt-1")}>
					{block.content}
				</p>
			</aside>
		);
	}

	if (block.type === "markdown") {
		return <AbilityMarkdownBody content={block.content} />;
	}

	return (
		<section className="flex flex-col gap-3">
			<BlockTitle>{block.title}</BlockTitle>
			<div className="flex flex-wrap gap-2">
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
