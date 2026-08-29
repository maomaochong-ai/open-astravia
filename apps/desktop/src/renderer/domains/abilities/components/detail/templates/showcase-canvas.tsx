import { cn } from "@vetta/ui";
import { useId, type JSX, type ReactNode } from "react";
import type { AbilityShowcaseCanvas } from "@shared/lib/api";

/** 渐变舞台：primary 光晕 + 细网格，四角自然淡出。 */
export function ShowcaseStage({ children }: { children: ReactNode }): JSX.Element {
	return (
		<div className="relative overflow-hidden">
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

function TrafficLights(): JSX.Element {
	return (
		<div className="flex items-center gap-1">
			<span className="h-1.5 w-1.5 rounded-full bg-foreground/25" />
			<span className="h-1.5 w-1.5 rounded-full bg-foreground/18" />
			<span className="h-1.5 w-1.5 rounded-full bg-foreground/12" />
		</div>
	);
}

function AppWindow({
	title,
	children,
	className,
	bodyClassName,
	header,
}: {
	title?: string;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
	header?: ReactNode;
}): JSX.Element {
	return (
		<div
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm",
				className,
			)}
		>
			<div className="flex items-center gap-1.5 border-b border-border/50 bg-foreground/[0.04] px-2.5 py-1.5">
				<TrafficLights />
				{header ??
					(title ? (
						<span className="ml-1 min-w-0 truncate text-[10px] text-muted-foreground">{title}</span>
					) : (
						<div className="ml-1.5 h-1.5 w-14 rounded-full bg-foreground/10" />
					))}
			</div>
			<div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
		</div>
	);
}

function DesignCanvas({ title }: { title?: string }): JSX.Element {
	return (
		<div className="relative flex h-full min-h-0 overflow-hidden rounded-xl bg-foreground/[0.03] ring-1 ring-border/60">
			<div
				className="absolute inset-0 opacity-70"
				style={{
					backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--foreground) 18%, transparent) 1px, transparent 1.5px)",
					backgroundSize: "10px 10px",
				}}
				aria-hidden
			/>
			<div className="relative m-auto w-[78%]">
				<div className="relative rounded-lg border border-border/60 bg-background p-2">
					<div className="absolute -left-1 -top-1 h-1.5 w-1.5 rounded-[1px] bg-primary" />
					<div className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-[1px] bg-primary" />
					<div className="absolute -bottom-1 -left-1 h-1.5 w-1.5 rounded-[1px] bg-primary" />
					<div className="absolute -bottom-1 -right-1 h-1.5 w-1.5 rounded-[1px] bg-primary" />
					<div className="mb-1.5 h-3.5 w-fit rounded-full bg-foreground/10 px-2 text-[10px] leading-[14px] text-muted-foreground">
						{title || "Frame"}
					</div>
					<div className="relative h-12 overflow-hidden rounded-md bg-gradient-to-br from-primary/70 via-primary/25 to-transparent">
						<div className="absolute -right-5 -top-6 h-16 w-16 rounded-full bg-background/25 blur-md" />
						<div className="absolute bottom-2 left-2 h-1.5 w-16 rounded-full bg-background/55" />
					</div>
					<div className="mt-1.5 flex gap-1.5">
						<div className="h-7 flex-1 rounded-md bg-foreground/7 ring-1 ring-border/40" />
						<div className="h-7 w-10 rounded-md bg-foreground/5 ring-1 ring-border/40" />
					</div>
				</div>
			</div>
		</div>
	);
}

function CodeCanvas({ title }: { title?: string }): JSX.Element {
	const lines = [
		{ w: "w-[58%]", c: "bg-primary/50" },
		{ w: "w-[84%]", c: "bg-foreground/14" },
		{ w: "w-[46%]", c: "bg-primary/25" },
		{ w: "w-[72%]", c: "bg-primary/40" },
		{ w: "w-[63%]", c: "bg-foreground/12" },
		{ w: "w-[38%]", c: "bg-foreground/10" },
	];
	return (
		<AppWindow
			header={
				<div className="ml-1.5 flex min-w-0 items-center gap-1">
					<div className="rounded-t-md bg-background px-2 py-0.5 text-[10px] text-foreground ring-1 ring-border/50">
						{title || "main.ts"}
					</div>
					<div className="rounded-t-md px-2 py-0.5 text-[10px] text-muted-foreground/70">lib.ts</div>
				</div>
			}
			bodyClassName="flex min-h-0 flex-col"
		>
			<div className="flex min-h-0 flex-1 gap-2 px-2 py-2">
				<div className="flex w-3 shrink-0 flex-col gap-[5px] pt-px text-right font-mono text-[10px] leading-none text-muted-foreground/50">
					{lines.map((_, index) => (
						<span key={`line-${index + 1}`}>{index + 1}</span>
					))}
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-[5px]">
					{lines.map((line, index) => (
						<div key={line.w} className="relative h-[8px]">
							{index === 3 ? <span className="absolute -inset-x-1.5 -inset-y-1 rounded bg-primary/12 ring-1 ring-primary/20" /> : null}
							<div className={cn("relative h-1.5 rounded-full", line.w, line.c)} />
						</div>
					))}
				</div>
			</div>
			<div className="flex items-center gap-2 border-t border-border/50 px-2.5 py-1">
				<span className="h-1.5 w-8 rounded-full bg-primary/40" />
				<span className="h-1.5 w-10 rounded-full bg-foreground/12" />
				<span className="ml-auto h-1.5 w-6 rounded-full bg-foreground/10" />
			</div>
		</AppWindow>
	);
}

function DocsCanvas({ title }: { title?: string }): JSX.Element {
	return (
		<div className="flex h-full min-h-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 ring-1 ring-border/60">
			<div className="mx-3 w-full rounded-lg border border-border/50 bg-background px-3 py-2.5">
				<div className="h-2.5 w-1/2 rounded-full bg-foreground/35" />
				{title ? <div className="mt-1 truncate text-[10px] text-muted-foreground">{title}</div> : null}
				<div className="mt-2 space-y-1.5">
					<div className="h-1.5 w-full rounded-full bg-foreground/12" />
					<div className="h-1.5 w-[92%] rounded-full bg-foreground/10" />
					<div className="h-1.5 w-[74%] rounded-full bg-foreground/8" />
				</div>
				<div className="mt-2.5 rounded-md bg-primary/8 px-2 py-1.5 ring-1 ring-primary/15">
					<div className="flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-sm bg-primary/70" />
						<div className="h-1.5 w-2/3 rounded-full bg-foreground/16" />
					</div>
					<div className="mt-1.5 flex items-center gap-1.5">
						<span className="h-2 w-2 rounded-sm ring-1 ring-border/70" />
						<div className="h-1.5 w-1/2 rounded-full bg-foreground/10" />
					</div>
				</div>
			</div>
		</div>
	);
}

function GenericCanvas(): JSX.Element {
	const gradientId = useId();
	return (
		<AppWindow
			header={
				<div className="ml-auto flex items-center gap-1.5">
					<span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
					<div className="h-1.5 w-8 rounded-full bg-foreground/12" />
				</div>
			}
		>
			<div className="flex h-full flex-col gap-2 p-2">
				<div className="grid grid-cols-2 gap-2">
					<div className="rounded-lg bg-foreground/[0.04] p-2 ring-1 ring-border/40">
						<div className="h-1.5 w-8 rounded-full bg-foreground/20" />
						<div className="mt-1.5 h-2.5 w-12 rounded-full bg-primary/55" />
					</div>
					<div className="rounded-lg bg-foreground/[0.04] p-2 ring-1 ring-border/40">
						<div className="h-1.5 w-10 rounded-full bg-foreground/20" />
						<div className="mt-1.5 h-2.5 w-9 rounded-full bg-primary/30" />
					</div>
				</div>
				<div className="relative min-h-[58px] flex-1 overflow-hidden rounded-lg bg-foreground/[0.04] ring-1 ring-border/40">
					<svg viewBox="0 0 120 48" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
						<title>trend</title>
						<defs>
							<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
								<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
							</linearGradient>
						</defs>
						<g className="text-primary">
							<path d="M0 38 L20 30 L40 34 L60 18 L80 24 L100 10 L120 16 L120 48 L0 48 Z" fill={`url(#${gradientId})`} />
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
			</div>
		</AppWindow>
	);
}

function BrowserCanvas({ title }: { title?: string }): JSX.Element {
	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/80">
			<div className="flex items-end gap-1 border-b border-border/50 bg-foreground/[0.04] px-2 pt-1.5">
				<TrafficLights />
				<div className="ml-1 flex min-w-0 flex-1 items-end gap-0.5">
					<div className="rounded-t-md bg-background px-2.5 py-1 text-[10px] text-foreground ring-1 ring-border/50">
						{title || "Tab"}
					</div>
					<div className="rounded-t-md px-2 py-1 text-[10px] text-muted-foreground/60">
						<span className="inline-block h-1 w-6 rounded-full bg-foreground/15" />
					</div>
					<span className="mb-1 ml-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[10px] text-muted-foreground/50 ring-1 ring-border/40">
						+
					</span>
				</div>
			</div>
			<div className="border-b border-border/40 px-2 py-1.5">
				<div className="flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2 py-1 ring-1 ring-border/40">
					<span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-border/70" />
					<div className="h-1.5 flex-1 rounded-full bg-foreground/12" />
					<div className="h-1.5 w-8 rounded-full bg-foreground/8" />
				</div>
			</div>
			<div className="flex flex-1 flex-col gap-1.5 p-2">
				<div className="h-5 rounded-md bg-foreground/[0.05] ring-1 ring-border/30" />
				<div className="flex items-center gap-2 rounded-md px-1 py-1">
					<span className="h-4 w-4 rounded bg-primary/25" />
					<div className="h-1.5 flex-1 rounded-full bg-foreground/14" />
					<div className="h-1.5 w-8 rounded-full bg-foreground/8" />
				</div>
				<div className="flex items-center gap-2 rounded-md bg-primary/8 px-1 py-1 ring-1 ring-primary/15">
					<span className="h-4 w-4 rounded bg-primary/40" />
					<div className="h-1.5 flex-1 rounded-full bg-foreground/16" />
					<div className="h-1.5 w-6 rounded-full bg-primary/35" />
				</div>
				<div className="flex items-center gap-2 rounded-md px-1 py-1">
					<span className="h-4 w-4 rounded bg-foreground/10" />
					<div className="h-1.5 w-2/3 rounded-full bg-foreground/12" />
				</div>
			</div>
		</div>
	);
}

function TerminalCanvas(): JSX.Element {
	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
			<div className="flex items-center gap-1.5 border-b border-border/50 px-2.5 py-1.5">
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/25" />
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/18" />
				<span className="h-1.5 w-1.5 rounded-full bg-foreground/12" />
				<div className="ml-1.5 h-1.5 w-12 rounded-full bg-foreground/10" />
			</div>
			<div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5 font-mono">
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-emerald-400">$</span>
					<div className="h-1.5 w-2/5 rounded-full bg-foreground/30" />
					<span className="h-3 w-px bg-emerald-400/80" />
				</div>
				<div className="h-1.5 w-3/4 rounded-full bg-foreground/18" />
				<div className="h-1.5 w-1/2 rounded-full bg-foreground/12" />
				<div className="mt-1 flex items-center gap-1.5">
					<span className="h-2 w-2 rounded-full bg-emerald-400" />
					<div className="h-1.5 w-2/5 rounded-full bg-emerald-500/15" />
				</div>
				<div className="mt-auto flex items-center gap-1.5">
					<span className="text-[10px] text-emerald-400">$</span>
					<span className="h-3 w-px bg-emerald-400/80" />
				</div>
			</div>
		</div>
	);
}

function BoardCanvas(): JSX.Element {
	const columns = [
		{ header: "bg-foreground/20", cards: ["h-8", "h-6"] },
		{ header: "bg-primary/55", cards: ["h-10", "h-7", "h-6"] },
		{ header: "bg-emerald-500/15", cards: ["h-7"] },
	];
	return (
		<div className="grid h-full min-h-0 grid-cols-3 gap-1.5 overflow-hidden rounded-xl bg-foreground/[0.03] p-2 ring-1 ring-border/60">
			{columns.map((column) => (
				<div key={column.header} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-background/80 p-1.5 ring-1 ring-border/40">
					<div className={cn("h-1.5 w-8 rounded-full", column.header)} />
					{column.cards.map((height) => (
						<div key={height} className={cn("rounded-md bg-foreground/[0.05] ring-1 ring-border/35", height)}>
							<div className="p-1.5">
								<div className="h-1 w-3/4 rounded-full bg-foreground/18" />
								<div className="mt-1 h-1 w-1/2 rounded-full bg-foreground/10" />
							</div>
						</div>
					))}
				</div>
			))}
		</div>
	);
}

export function CanvasByMotif({ motif, title }: { motif: AbilityShowcaseCanvas; title?: string }): JSX.Element {
	let canvas: JSX.Element;
	switch (motif) {
		case "design":
			canvas = <DesignCanvas title={title} />;
			break;
		case "code":
			canvas = <CodeCanvas title={title} />;
			break;
		case "docs":
			canvas = <DocsCanvas title={title} />;
			break;
		case "browser":
			canvas = <BrowserCanvas title={title} />;
			break;
		case "terminal":
			canvas = <TerminalCanvas />;
			break;
		case "board":
			canvas = <BoardCanvas />;
			break;
		default:
			canvas = <GenericCanvas />;
	}
	return <div className="h-full min-h-0">{canvas}</div>;
}
