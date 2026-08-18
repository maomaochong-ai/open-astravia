import { BotAvatar } from "@vetta/theme-ui/shared";
import { cn } from "@vetta/ui";
import type { AbilityShowcaseCanvas } from "@shared/lib/api";

/**
 * 呈现模板：chat-over-canvas / chat-thread
 * 左侧是悬浮的产品窗口 mock（CSS 构图，非真实截图），右侧是对话；
 * 底色走 --primary 的渐变舞台，保证浅色 / 深色都成立。
 */

/** 悬浮窗口外壳：顶栏 + 内容，靠阴影和 ring 拉出层次。 */
function MockWindow({ children }: { children: JSX.Element }): JSX.Element {
	return (
		<div className="overflow-hidden rounded-xl bg-background/85 shadow-[0_20px_44px_-20px_rgb(0_0_0/0.6)] ring-1 ring-border/70 backdrop-blur-sm">
			<div className="flex items-center gap-1.5 border-b border-border/50 bg-foreground/[0.04] px-2.5 py-1.5">
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/25" />
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/18" />
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/12" />
				<div className="ml-1.5 h-1.5 w-14 rounded-full bg-foreground/10" />
			</div>
			{children}
		</div>
	);
}

function DesignCanvas(): JSX.Element {
	return (
		<MockWindow>
			<div className="flex flex-col gap-1.5 p-2">
				{/* 主视觉 */}
				<div className="relative h-10 overflow-hidden rounded-lg bg-gradient-to-br from-primary/60 via-primary/25 to-transparent">
					<div className="absolute -right-4 -top-6 h-16 w-16 rounded-full bg-background/20 blur-md" />
					<div className="absolute bottom-2 left-2 h-1.5 w-16 rounded-full bg-background/50" />
					<div className="absolute bottom-2 left-20 h-1.5 w-8 rounded-full bg-background/30" />
				</div>
				<div className="flex gap-2">
					<div className="h-6 flex-1 rounded-lg bg-foreground/8 ring-1 ring-border/40" />
					<div className="h-6 w-8 rounded-lg bg-foreground/5 ring-1 ring-border/40" />
				</div>
				<div className="flex items-center gap-1.5">
					<span className="h-2.5 w-2.5 rounded-full bg-primary/70" />
					<span className="h-2.5 w-2.5 rounded-full bg-sky-400/60" />
					<span className="h-2.5 w-2.5 rounded-full bg-violet-400/60" />
					<div className="ml-1 h-1.5 flex-1 rounded-full bg-foreground/8" />
				</div>
			</div>
		</MockWindow>
	);
}

function CodeCanvas(): JSX.Element {
	const lines = [
		{ w: "w-[68%]", c: "bg-primary/45" },
		{ w: "w-[84%]", c: "bg-foreground/14" },
		{ w: "w-[52%]", c: "bg-sky-400/45" },
		{ w: "w-[76%]", c: "bg-foreground/12" },
		{ w: "w-[44%]", c: "bg-violet-400/45" },
		{ w: "w-[62%]", c: "bg-foreground/10" },
	];
	return (
		<MockWindow>
			<div className="flex gap-2 p-2">
				<div className="flex w-2 shrink-0 flex-col gap-1.5 pt-[3px]">
					{lines.map((line) => (
						<span key={line.w} className="h-1 rounded-full bg-foreground/12" />
					))}
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					{lines.map((line, index) => (
						<div key={line.w} className="relative">
							{index === 2 ? (
								<span className="absolute -inset-x-1.5 -inset-y-1 rounded bg-primary/10 ring-1 ring-primary/20" />
							) : null}
							<div className={cn("relative h-1.5 rounded-full", line.w, line.c)} />
						</div>
					))}
				</div>
			</div>
		</MockWindow>
	);
}

function DocsCanvas(): JSX.Element {
	return (
		<MockWindow>
			<div className="flex flex-col gap-1.5 p-2">
				<div className="h-2 w-1/2 rounded-full bg-foreground/30" />
				<div className="space-y-1.5">
					<div className="h-1.5 w-full rounded-full bg-foreground/12" />
					<div className="h-1.5 w-[88%] rounded-full bg-foreground/10" />
				</div>
				<div className="rounded-lg bg-gradient-to-br from-primary/15 to-transparent p-2 ring-1 ring-border/40">
					<div className="flex items-center gap-1.5">
						<span className="h-2.5 w-2.5 rounded-sm bg-primary/70" />
						<div className="h-1.5 w-1/2 rounded-full bg-foreground/14" />
					</div>
					<div className="mt-1.5 flex items-center gap-1.5">
						<span className="h-2.5 w-2.5 rounded-sm ring-1 ring-border/60" />
						<div className="h-1.5 w-2/3 rounded-full bg-foreground/8" />
					</div>
				</div>
			</div>
		</MockWindow>
	);
}

function GenericCanvas(): JSX.Element {
	return (
		<MockWindow>
			<div className="flex flex-col gap-1.5 p-2">
				{/* 面积图 */}
				<div className="relative h-11 overflow-hidden rounded-lg bg-foreground/[0.04] ring-1 ring-border/40">
					<svg viewBox="0 0 120 48" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
						<title>trend</title>
						<defs>
							<linearGradient id="showcase-area" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
								<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
							</linearGradient>
						</defs>
						<g className="text-primary">
							<path d="M0 38 L20 30 L40 34 L60 18 L80 24 L100 10 L120 16 L120 48 L0 48 Z" fill="url(#showcase-area)" />
							<path
								d="M0 38 L20 30 L40 34 L60 18 L80 24 L100 10 L120 16"
								fill="none"
								stroke="currentColor"
								strokeOpacity="0.8"
								strokeWidth="1.5"
								strokeLinejoin="round"
							/>
						</g>
					</svg>
				</div>
				<div className="flex gap-2">
					<div className="flex-1 rounded-lg bg-foreground/8 p-2 ring-1 ring-border/40">
						<div className="h-1.5 w-2/3 rounded-full bg-foreground/20" />
						<div className="mt-1.5 h-1.5 w-1/3 rounded-full bg-primary/50" />
					</div>
					<div className="flex-1 rounded-lg bg-foreground/8 p-2 ring-1 ring-border/40">
						<div className="h-1.5 w-1/2 rounded-full bg-foreground/20" />
						<div className="mt-1.5 h-1.5 w-2/5 rounded-full bg-sky-400/50" />
					</div>
				</div>
			</div>
		</MockWindow>
	);
}

function CanvasByMotif({ motif }: { motif: AbilityShowcaseCanvas }): JSX.Element {
	switch (motif) {
		case "design":
			return <DesignCanvas />;
		case "code":
			return <CodeCanvas />;
		case "docs":
			return <DocsCanvas />;
		default:
			return <GenericCanvas />;
	}
}

/** 渐变舞台：primary 光晕 + 细网格，四角自然淡出。 */
function ShowcaseStage({ children }: { children: JSX.Element }): JSX.Element {
	return (
		<div className="relative overflow-hidden rounded-2xl ring-1 ring-border/60">
			<div className="absolute inset-0 bg-gradient-to-br from-primary/12 via-background to-background" aria-hidden />
			<div
				className="absolute -left-16 -top-24 h-56 w-56 rounded-full blur-3xl"
				style={{ background: "color-mix(in srgb, var(--primary) 30%, transparent)" }}
				aria-hidden
			/>
			<div
				className="absolute -bottom-28 -right-10 h-56 w-56 rounded-full blur-3xl"
				style={{ background: "color-mix(in srgb, var(--primary) 14%, transparent)" }}
				aria-hidden
			/>
			<div
				className="absolute inset-0 opacity-50"
				style={{
					backgroundImage:
						"linear-gradient(to right, color-mix(in srgb, var(--border) 60%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 60%, transparent) 1px, transparent 1px)",
					backgroundSize: "16px 16px",
					maskImage: "radial-gradient(ellipse at 30% 20%, black, transparent 75%)",
					WebkitMaskImage: "radial-gradient(ellipse at 30% 20%, black, transparent 75%)",
				}}
				aria-hidden
			/>
			<div className="relative">{children}</div>
		</div>
	);
}

function ChatBubbles({
	userPrompt,
	assistantReply,
}: {
	userPrompt: string;
	assistantReply: string;
}): JSX.Element {
	return (
		<div className="flex flex-col justify-center gap-2">
			<div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-background/85 px-3 py-2 text-[11.5px] leading-relaxed text-foreground shadow-sm ring-1 ring-border/60 backdrop-blur-sm">
				{userPrompt}
			</div>
			<div className="flex items-start gap-2">
				<BotAvatar className="mt-1" />
				<div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-primary/12 px-3 py-2 text-[11.5px] leading-relaxed text-foreground shadow-sm ring-1 ring-primary/25 backdrop-blur-sm">
					{assistantReply}
				</div>
			</div>
		</div>
	);
}

export function ShowcaseChatOverCanvas({
	userPrompt,
	assistantReply,
	canvas,
}: {
	userPrompt: string;
	assistantReply: string;
	canvas: AbilityShowcaseCanvas;
}): JSX.Element {
	return (
		<section aria-label="ability-showcase-chat-over-canvas">
			<ShowcaseStage>
				{/* 左侧 mock 只做点缀，篇幅让给对话 */}
				<div className="grid grid-cols-[0.62fr_1.38fr] items-center gap-3 p-3">
					<CanvasByMotif motif={canvas} />
					<ChatBubbles userPrompt={userPrompt} assistantReply={assistantReply} />
				</div>
			</ShowcaseStage>
		</section>
	);
}

export function ShowcaseChatThread({
	userPrompt,
	assistantReply,
}: {
	userPrompt: string;
	assistantReply: string;
}): JSX.Element {
	return (
		<section aria-label="ability-showcase-chat-thread">
			<ShowcaseStage>
				<div className="p-3">
					<ChatBubbles userPrompt={userPrompt} assistantReply={assistantReply} />
				</div>
			</ShowcaseStage>
		</section>
	);
}
