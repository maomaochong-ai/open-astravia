import { DocsKicker } from "@/components/kicker";
import { cn } from "@/lib/cn";
import { getDocsMessages, type DocsLanguage } from "@/lib/i18n";
import type { ReactNode } from "react";

const gutter = "px-5 md:px-8 lg:px-14";

export function HomeHero({ children }: { children: ReactNode }) {
	return (
		<header
			className={cn(
				"mx-auto grid min-h-[78dvh] w-full max-w-[78rem] grid-cols-1 items-center gap-12 border-b border-fd-border bg-[size:3rem_3rem] py-16 md:grid-cols-[minmax(20rem,0.8fr)_minmax(26rem,1.2fr)] md:gap-10 md:bg-[size:4.5rem_4.5rem] md:py-[5.5rem_4.5rem] lg:grid-cols-[minmax(27rem,0.9fr)_minmax(30rem,1.1fr)] lg:gap-16",
				gutter,
				"bg-[image:linear-gradient(to_right,color-mix(in_srgb,var(--color-fd-border)_55%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_srgb,var(--color-fd-border)_55%,transparent)_1px,transparent_1px)] bg-[position:center_top] max-md:min-h-auto",
			)}
		>
			{children}
		</header>
	);
}

export function HomeHeroCopy({ children }: { children: ReactNode }) {
	return <div className="max-w-[43rem] animate-enter">{children}</div>;
}

export function HomeTitle({ children }: { children: ReactNode }) {
	return (
		<h1 className="m-0 max-w-[34rem] font-display text-[2.55rem] font-semibold leading-[1.16] tracking-[-0.02em] text-pretty md:text-[3.15rem] lg:text-[3.25rem] 2xl:text-[3.65rem]">
			{children}
		</h1>
	);
}

export function HomeEmphasis({ children }: { children: ReactNode }) {
	return (
		<span className="bg-[linear-gradient(transparent_64%,color-mix(in_srgb,var(--color-vetta-coral)_48%,transparent)_64%,color-mix(in_srgb,var(--color-vetta-coral)_48%,transparent)_88%,transparent_88%)]">
			{children}
		</span>
	);
}

export function HomeLead({ children }: { children: ReactNode }) {
	return (
		<p className="mt-7 max-w-[35rem] text-base leading-[1.85] text-fd-muted-foreground md:text-[1.08rem]">{children}</p>
	);
}

export function HomeActions({ children }: { children: ReactNode }) {
	return <div className="mt-10 flex flex-col items-start gap-[0.9rem] md:flex-row md:items-center md:gap-6">{children}</div>;
}

export function HomePrimary({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a
			className="inline-flex min-h-11 items-center gap-4 rounded-full bg-vetta-ink px-[1.05rem] text-[0.9rem] font-semibold whitespace-nowrap text-vetta-paper no-underline dark:bg-vetta-binding-fg dark:text-vetta-binding [&_span]:transition-transform [&_span]:duration-150 hover:[&_span]:translate-x-[0.2rem]"
			href={href}
		>
			{children}
		</a>
	);
}

export function HomeSecondary({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a
			className="inline-flex items-center gap-4 border-b border-current py-[0.55rem] text-[0.9rem] font-semibold whitespace-nowrap text-fd-foreground no-underline"
			href={href}
		>
			{children}
		</a>
	);
}

export function HomeProof({ children, language = "zh" }: { children: ReactNode; language?: DocsLanguage }) {
	const text = getDocsMessages(language);

	return (
		<ul
			className="mt-12 grid list-none gap-0 border-t border-fd-border p-0 [&>li]:grid [&>li]:grid-cols-[7.5rem_minmax(0,1fr)] [&>li]:gap-4 [&>li]:border-b [&>li]:border-fd-border [&>li]:py-[0.8rem] [&_strong]:text-[0.76rem] [&_strong]:font-semibold [&_span]:text-[0.74rem] [&_span]:text-fd-muted-foreground"
			aria-label={text.homeProofAria}
		>
			{children}
		</ul>
	);
}

export function HomeProduct({ children }: { children: ReactNode }) {
	return (
		<figure className="relative m-0 grid min-w-0 grid-rows-[auto_1fr_auto] animate-enter overflow-hidden rounded-[10px] border border-fd-border bg-vetta-binding [animation-delay:90ms]">
			{children}
		</figure>
	);
}

export function HomeProductBar({ children }: { children: ReactNode }) {
	return (
		<div className="flex justify-between rounded-t-[10px] border-b border-white/12 px-4 py-3 font-mono text-[0.6rem] tracking-[0.12em] text-[#9b9daa]">
			{children}
		</div>
	);
}

export function HomeProductImage(props: { src: string; alt: string; width: number; height: number }) {
	return <img {...props} className="m-0 block h-auto w-full object-cover" fetchPriority="high" />;
}

export function HomeProductCaption({ children }: { children: ReactNode }) {
	return (
		<figcaption className="rounded-b-[10px] border-t border-white/12 px-4 py-[0.9rem] text-[0.7rem] leading-normal text-[#b7b9c2]">
			{children}
		</figcaption>
	);
}

export function HomeMascot() {
	return (
		<img
			className="absolute bottom-[3.4rem] left-[0.85rem] z-[1] size-[4.1rem] rounded-full border-[3px] border-fd-background bg-vetta-binding object-cover shadow-[0_10px_28px_color-mix(in_srgb,var(--color-vetta-ink)_16%,transparent)] md:bottom-[3.15rem] md:size-[4.6rem] lg:size-[5.75rem]"
			src="/images/vetta-app-icon.webp"
			alt=""
			width="120"
			height="120"
		/>
	);
}

export function HomeSection({ children }: { children: ReactNode }) {
	return (
		<section className={cn("mx-auto w-full max-w-[78rem] border-b border-fd-border py-[4.5rem] md:py-24", gutter)}>
			{children}
		</section>
	);
}

export function HomeSectionHeading({
	kicker,
	title,
	description,
}: {
	kicker: string;
	title: string;
	description?: string;
}) {
	return (
		<div className="mb-10 grid grid-cols-1 md:mb-14 md:grid-cols-[minmax(10rem,0.7fr)_1.3fr] md:items-end md:gap-x-12">
			<DocsKicker className="md:col-start-1 md:self-start">{kicker}</DocsKicker>
			<h2 className="m-0 font-display text-[1.9rem] font-semibold leading-[1.22] tracking-[-0.02em] text-pretty md:col-start-2 md:text-[2.45rem]">
				{title}
			</h2>
			{description ? (
				<p className="mt-3 max-w-[30rem] text-[0.95rem] text-fd-muted-foreground md:col-start-2">{description}</p>
			) : null}
		</div>
	);
}

export function HomeFlow({ children }: { children: ReactNode }) {
	return (
		<ol className="relative m-0 grid list-none grid-cols-1 border-t border-fd-border p-0 lg:grid-cols-5 before:absolute before:-top-px before:left-0 before:h-0.5 before:w-full before:bg-vetta-coral lg:before:w-1/5 [&>li]:grid [&>li]:min-h-32 [&>li]:content-start [&>li]:border-b [&>li]:border-s [&>li]:border-fd-border [&>li]:p-[1.15rem] max-lg:[&>li]:border-e lg:[&>li]:min-h-48 [&>li:first-child]:bg-vetta-coral/[0.07] [&>li:last-child]:border-e [&>li>span]:font-mono [&>li>span]:text-[0.65rem] [&>li>span]:tracking-[0.08em] [&>li>span]:text-vetta-coral [&>li>strong]:mt-[2.2rem] [&>li>strong]:font-display [&>li>strong]:text-base [&>li>strong]:font-semibold [&>li>small]:mt-2.5 [&>li>small]:text-[0.72rem] [&>li>small]:leading-[1.65] [&>li>small]:text-fd-muted-foreground">
			{children}
		</ol>
	);
}

export function HomeInlineLink({ href, children }: { href: string; children: ReactNode }) {
	return (
		<a
			className="mt-6 inline-flex gap-4 text-[0.82rem] font-semibold text-inherit no-underline [&_span]:text-vetta-coral [&_span]:transition-transform [&_span]:duration-150 hover:[&_span]:translate-x-[0.2rem]"
			href={href}
		>
			{children}
		</a>
	);
}

export function HomeIndex({ children }: { children: ReactNode }) {
	return <div className="grid grid-cols-1 border-t border-fd-border lg:grid-cols-3">{children}</div>;
}

export function HomeIndexGroup({ index, title, children }: { index: string; title: string; children: ReactNode }) {
	return (
		<div className="min-w-0 border-s border-e border-fd-border">
			<div className="flex min-h-[5.4rem] items-baseline gap-4 border-b border-fd-border bg-fd-card/55 p-5">
				<span className="font-mono text-[0.65rem] tracking-[0.08em] text-vetta-coral">{index}</span>
				<h3 className="m-0 font-display text-[1.2rem] font-semibold">{title}</h3>
			</div>
			{children}
		</div>
	);
}

export function HomeIndexLink({ href, title, description }: { href: string; title: string; description: string }) {
	return (
		<a
			className="group grid min-h-[4.6rem] grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-fd-border px-5 py-4 text-inherit no-underline transition-colors hover:bg-vetta-coral/[0.08] md:min-h-20"
			href={href}
		>
			<span className="text-[0.9rem] font-semibold">{title}</span>
			<small className="col-start-1 text-[0.72rem] leading-[1.55] text-fd-muted-foreground">{description}</small>
			<b
				className="col-start-2 row-span-2 self-center text-[0.85rem] font-normal text-vetta-coral transition-transform group-hover:translate-x-[0.15rem] group-hover:-translate-y-[0.15rem]"
				aria-hidden="true"
			>
				↗
			</b>
		</a>
	);
}

export function HomeOutcomes({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-1 border-t border-s border-fd-border md:grid-cols-2 [&>div]:grid [&>div]:min-h-56 [&>div]:border-e [&>div]:border-b [&>div]:border-fd-border [&>div]:p-[1.4rem] [&>div]:transition-colors hover:[&>div]:bg-vetta-coral/[0.06] [&>div>span]:font-display [&>div>span]:text-[0.92rem] [&>div>span]:font-semibold [&>div>span]:text-vetta-coral [&>div>h3]:mt-[1.4rem] [&>div>h3]:text-[1.12rem] [&>div>h3]:font-semibold [&>div>p]:mt-[0.7rem] [&>div>p]:mb-6 [&>div>p]:max-w-[28rem] [&>div>p]:text-[0.82rem] [&>div>p]:leading-[1.7] [&>div>p]:text-fd-muted-foreground [&>div>a]:self-end [&>div>a]:text-[0.78rem] [&>div>a]:font-semibold [&>div>a]:text-inherit [&>div>a]:no-underline">
			{children}
		</div>
	);
}

export function HomeFooter({ kicker, children }: { kicker: string; children: ReactNode }) {
	return (
		<footer
			className={cn(
				"relative w-full overflow-hidden bg-vetta-binding py-[4.5rem] text-vetta-binding-fg md:py-20 lg:pt-20 lg:pb-24",
				gutter,
			)}
		>
			<img
				className="absolute right-5 bottom-[1.4rem] size-[3.4rem] rounded-full border-2 border-vetta-binding-fg/18 object-cover md:top-[3.2rem] md:right-8 md:bottom-auto md:size-[4.5rem] lg:right-14"
				src="/images/vetta-app-icon.webp"
				alt=""
				width="72"
				height="72"
			/>
			<DocsKicker className="mx-auto mb-[1.15rem] flex max-w-[78rem] text-vetta-binding-fg/60">{kicker}</DocsKicker>
			<div className="mx-auto grid max-w-[78rem] grid-cols-1 items-end gap-8 md:gap-16 lg:grid-cols-[1.25fr_0.75fr] [&_h2]:m-0 [&_h2]:font-display [&_h2]:text-[2.15rem] [&_h2]:font-semibold [&_h2]:leading-[1.2] [&_h2]:tracking-[-0.02em] [&_h2]:text-pretty lg:[&_h2]:text-5xl [&>p]:m-0 [&>p]:text-[0.9rem] [&>p]:leading-[1.8] [&>p]:text-vetta-binding-fg/70 [&_a]:text-vetta-coral [&_a]:underline [&_a]:underline-offset-[0.2em]">
				{children}
			</div>
		</footer>
	);
}
