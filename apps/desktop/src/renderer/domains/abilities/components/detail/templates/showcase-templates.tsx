import { BotAvatar } from "@vetta/theme-ui/shared";
import { cn } from "@vetta/ui";
import type { AbilityShowcase, AbilityShowcaseCanvas, AbilityShowcaseTemplate } from "@shared/lib/api";
import type { JSX } from "react";
import { CanvasByMotif, ShowcaseStage } from "./showcase-canvas";

export interface ShowcaseViewProps {
	userPrompt: string;
	assistantReply: string;
	canvas: AbilityShowcaseCanvas;
	brandName?: string;
	brandIconUrl?: string;
}

function ChatBubbles({
	userPrompt,
	assistantReply,
	compact = false,
}: {
	userPrompt: string;
	assistantReply: string;
	compact?: boolean;
}): JSX.Element {
	return (
		<div className={cn("flex flex-col justify-center", compact ? "gap-1.5" : "gap-2")}>
			<div
				className={cn(
					"ml-auto line-clamp-3 rounded-xl rounded-br-md border border-border/60 bg-background/85 text-foreground backdrop-blur-sm",
					compact ? "max-w-full px-2.5 py-1.5 text-[11px] leading-snug" : "max-w-[92%] px-3 py-2 text-[12px] leading-snug",
				)}
			>
				{userPrompt}
			</div>
			<div className="flex items-start gap-2">
				<BotAvatar className="mt-1 shrink-0" />
				<div
					className={cn(
						"min-w-0 flex-1 line-clamp-3 rounded-xl rounded-tl-md border border-primary/25 bg-primary/10 text-foreground backdrop-blur-sm",
						compact ? "px-2.5 py-1.5 text-[11px] leading-snug" : "px-3 py-2 text-[12px] leading-snug",
					)}
				>
					{assistantReply}
				</div>
			</div>
		</div>
	);
}

function BrandChip({ name, iconUrl }: { name?: string; iconUrl?: string }): JSX.Element | null {
	if (!name && !iconUrl) return null;
	return (
		<div className="flex items-center gap-1.5 rounded-full bg-background/80 px-2 py-0.5 ring-1 ring-border/50">
			{iconUrl ? <img src={iconUrl} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" /> : null}
			{name ? <span className="max-w-[9rem] truncate text-[10px] text-muted-foreground">{name}</span> : null}
		</div>
	);
}

/** 产品窗口与对话同一行：窗口在左，气泡在右。 */
export function ShowcaseChatOverCanvas({
	userPrompt,
	assistantReply,
	canvas,
	brandName,
}: ShowcaseViewProps): JSX.Element {
	return (
		<section aria-label="ability-showcase-chat-over-canvas">
			<ShowcaseStage>
				<div
					data-showcase-layout="split"
					className="grid h-44 grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] items-stretch gap-3 overflow-hidden p-3"
				>
					<CanvasByMotif motif={canvas} title={brandName} />
					<div className="flex min-w-0 items-center">
						<ChatBubbles userPrompt={userPrompt} assistantReply={assistantReply} compact />
					</div>
				</div>
			</ShowcaseStage>
		</section>
	);
}

/** 完整会话窗，而不是舞台上的两枚气泡。 */
export function ShowcaseChatThread({ userPrompt, assistantReply, brandName, brandIconUrl }: ShowcaseViewProps): JSX.Element {
	return (
		<section aria-label="ability-showcase-chat-thread">
			<ShowcaseStage>
				<div className="p-3">
					<div className="mx-auto flex h-44 max-w-[22rem] flex-col overflow-hidden rounded-xl border border-border/60 bg-card/90">
						<div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
							{brandIconUrl ? (
								<img src={brandIconUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
							) : (
								<BotAvatar />
							)}
							<div className="min-w-0">
								<div className="truncate text-[11px] font-medium text-foreground">{brandName || "Agent"}</div>
								<div className="mt-0.5 h-1 w-10 rounded-full bg-emerald-400/70" />
							</div>
						</div>
						<div className="flex flex-1 flex-col justify-end gap-2 px-3 py-2.5">
							<ChatBubbles userPrompt={userPrompt} assistantReply={assistantReply} compact />
						</div>
						<div className="border-t border-border/50 px-3 py-2">
							<div className="h-7 rounded-full bg-foreground/[0.04] ring-1 ring-border/40" />
						</div>
					</div>
				</div>
			</ShowcaseStage>
		</section>
	);
}

/** 只展示产品窗口和一句说明，没有对话气泡。 */
export function ShowcaseCanvasHero({ userPrompt, assistantReply, canvas, brandName }: ShowcaseViewProps): JSX.Element {
	return (
		<section aria-label="ability-showcase-canvas-hero">
			<ShowcaseStage>
				<div className="flex h-44 flex-col gap-2 overflow-hidden p-3">
					<div className="min-h-0 flex-1">
						<CanvasByMotif motif={canvas} title={brandName} />
					</div>
					<div className="flex items-center gap-3">
						<p className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">{assistantReply}</p>
						<div className="max-w-[42%] shrink-0 truncate rounded-full bg-background/80 px-2.5 py-1 text-[10px] text-muted-foreground ring-1 ring-border/50">
							{userPrompt}
						</div>
					</div>
				</div>
			</ShowcaseStage>
		</section>
	);
}

/** 提示词变成产物：左输入、右窗口，不是问答。 */
export function ShowcasePromptResult({ userPrompt, assistantReply, canvas, brandName }: ShowcaseViewProps): JSX.Element {
	return (
		<section aria-label="ability-showcase-prompt-result">
			<ShowcaseStage>
				<div
					data-showcase-layout="split"
					className="grid h-44 grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-stretch gap-3 overflow-hidden p-3"
				>
					<div className="flex min-w-0 flex-col justify-center rounded-xl border border-border/50 bg-card/80 p-3">
						<div className="h-1.5 w-8 rounded-full bg-foreground/15" />
						<p className="mt-2 line-clamp-4 text-[12px] leading-snug text-foreground">{userPrompt}</p>
					</div>
					<div className="flex min-w-0 flex-col gap-1.5">
						<div className="min-h-0 flex-1">
							<CanvasByMotif motif={canvas} title={brandName} />
						</div>
						<p className="truncate text-[11px] text-muted-foreground">{assistantReply}</p>
					</div>
				</div>
			</ShowcaseStage>
		</section>
	);
}

/** 命令面板：检索条 + 高亮结果。 */
export function ShowcaseSpotlight({ userPrompt, assistantReply, brandName, brandIconUrl }: ShowcaseViewProps): JSX.Element {
	return (
		<section aria-label="ability-showcase-spotlight">
			<ShowcaseStage>
				<div className="flex h-44 items-center justify-center overflow-hidden p-3">
					<div className="w-full max-w-[22rem] overflow-hidden rounded-xl border border-border/60 bg-card/90">
						<div className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5">
							<span className="h-2 w-2 rounded-full ring-1 ring-border/70" />
							<div className="min-w-0 flex-1 truncate text-[12px] text-foreground">{userPrompt}</div>
							<BrandChip name={brandName} iconUrl={brandIconUrl} />
						</div>
						<div className="flex flex-col gap-1 p-1.5">
							<div className="flex items-center gap-2 rounded-lg bg-primary/12 px-2.5 py-2 ring-1 ring-primary/20">
								<span className="h-4 w-4 rounded-md bg-primary/35" />
								<div className="min-w-0 flex-1 truncate text-[12px] text-foreground">{assistantReply}</div>
							</div>
							<div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
								<span className="h-4 w-4 rounded-md bg-foreground/8" />
								<div className="h-1.5 w-3/5 rounded-full bg-foreground/12" />
							</div>
							<div className="flex items-center gap-2 rounded-lg px-2.5 py-2">
								<span className="h-4 w-4 rounded-md bg-foreground/8" />
								<div className="h-1.5 w-2/5 rounded-full bg-foreground/10" />
							</div>
						</div>
					</div>
				</div>
			</ShowcaseStage>
		</section>
	);
}

/** 迷你工作台：活动栏 + 产品窗口 + 助手批注。 */
export function ShowcaseWorkbench({ userPrompt, assistantReply, canvas, brandName }: ShowcaseViewProps): JSX.Element {
	return (
		<section aria-label="ability-showcase-workbench">
			<ShowcaseStage>
				<div
					data-showcase-layout="split"
					className="grid h-44 grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,0.9fr)] items-stretch gap-2 overflow-hidden p-2"
				>
					<div className="flex flex-col items-center gap-2 rounded-lg bg-foreground/[0.04] py-2 ring-1 ring-border/40">
						<span className="h-4 w-4 rounded-md bg-primary/50 ring-1 ring-primary/30" />
						<span className="h-4 w-4 rounded-md bg-foreground/10" />
						<span className="h-4 w-4 rounded-md bg-foreground/10" />
						<span className="mt-auto h-4 w-4 rounded-full bg-foreground/12" />
					</div>
					<CanvasByMotif motif={canvas} title={brandName} />
					<div className="flex min-w-0 flex-col justify-center gap-2 overflow-hidden">
						<div className="line-clamp-3 rounded-xl border border-border/50 bg-card/80 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
							{userPrompt}
						</div>
						<div className="line-clamp-3 rounded-xl border border-primary/25 bg-primary/10 px-2.5 py-2 text-[11px] leading-snug text-foreground">
							{assistantReply}
						</div>
					</div>
				</div>
			</ShowcaseStage>
		</section>
	);
}

const SHOWCASE_VIEWS: Record<AbilityShowcaseTemplate, (props: ShowcaseViewProps) => JSX.Element> = {
	"chat-over-canvas": ShowcaseChatOverCanvas,
	"chat-thread": ShowcaseChatThread,
	"canvas-hero": ShowcaseCanvasHero,
	"prompt-result": ShowcasePromptResult,
	"spotlight": ShowcaseSpotlight,
	"workbench": ShowcaseWorkbench,
};

export function renderAbilityShowcase(showcase: AbilityShowcase, index: number): JSX.Element | null {
	if (!(showcase.template in SHOWCASE_VIEWS)) return null;
	const View = SHOWCASE_VIEWS[showcase.template];
	return (
		<View
			key={`${showcase.template}-${index}`}
			userPrompt={showcase.user_prompt}
			assistantReply={showcase.assistant_reply}
			canvas={showcase.canvas ?? "generic"}
			brandName={showcase.brand_name}
			brandIconUrl={showcase.brand_icon_url}
		/>
	);
}
