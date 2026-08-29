import { cn } from "@/lib/cn";
import type { DocsLanguage } from "@/lib/i18n";
import { fieldNoteIsAlert, fieldNoteLabel, type FieldNoteTone } from "@/lib/reading";
import type { ComponentProps, ReactNode } from "react";

function StudioKicker({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<p className={cn("m-0 font-mono text-[0.64rem] font-medium tracking-[0.14em] text-vetta-coral uppercase", className)}>
			{children}
		</p>
	);
}

export function Takeaways({ children, language = "zh" }: { children: ReactNode; language?: DocsLanguage }) {
	return (
		<section
			className="not-prose mb-10 grid gap-4 border-b border-fd-border pb-8 md:grid-cols-[7.5rem_minmax(0,1fr)] md:items-start"
			aria-label={language === "en" ? "Key takeaways" : "读完带走"}
		>
			<StudioKicker className="pt-1">{language === "en" ? "READ / TAKEAWAYS" : "READ / 带走"}</StudioKicker>
			<ol className="docs-takeaways m-0 grid list-none grid-cols-1 gap-0 p-0 sm:grid-cols-3">
				{children}
			</ol>
		</section>
	);
}

export function Kit({ children }: { children: ReactNode }) {
	return (
		<div className="not-prose my-8 grid grid-cols-1 border-t border-s border-fd-border md:grid-cols-3">{children}</div>
	);
}

export function KitItem({ index, title, children }: { index: string; title: string; children: ReactNode }) {
	return (
		<article className="grid min-h-[11rem] content-start gap-2 border-e border-b border-fd-border p-5 [&_a]:text-inherit [&_a]:underline [&_a]:decoration-vetta-coral/55 [&_a]:underline-offset-[0.2em] [&_p]:m-0">
			<span className="font-mono text-[0.64rem] tracking-[0.1em] text-vetta-coral">{index}</span>
			<h3 className="m-0 font-display text-[1.12rem] font-semibold">{title}</h3>
			<div className="text-[0.78rem] leading-[1.65] text-fd-muted-foreground">{children}</div>
		</article>
	);
}

export function Spread({ index, title, children }: { index: string; title: string; children: ReactNode }) {
	return (
		<section className="not-prose my-7 grid gap-4 border-y border-fd-border py-8 md:grid-cols-[minmax(11rem,0.34fr)_minmax(0,1fr)] md:gap-12 md:py-10">
			<header>
				<span className="font-mono text-[0.7rem] tracking-[0.1em] text-vetta-coral">{index}</span>
				<h3 className="mt-3 font-display text-[1.35rem] font-semibold leading-[1.25] text-pretty">{title}</h3>
			</header>
			<div className="text-[0.95rem] leading-[1.8] text-fd-muted-foreground [&_p]:m-0 [&_p+p]:mt-4">{children}</div>
		</section>
	);
}

export function Entries({ children }: { children: ReactNode }) {
	return (
		<div className="not-prose my-8 grid grid-cols-1 border-t border-s border-fd-border sm:grid-cols-2">{children}</div>
	);
}

export function Entry({
	kicker,
	title,
	href,
	children,
}: {
	kicker: string;
	title: string;
	href?: string;
	children: ReactNode;
}) {
	const className = cn(
		"grid min-h-[9.25rem] content-start gap-2 border-e border-b border-fd-border p-5",
		href && "text-inherit no-underline transition-colors hover:bg-vetta-coral/[0.08]",
	);
	const body = (
		<>
			<span className="font-mono text-[0.64rem] tracking-[0.1em] text-vetta-coral">{kicker}</span>
			<h3 className="m-0 font-display text-[1.05rem] font-semibold">{title}</h3>
			<p className="m-0 text-[0.78rem] leading-[1.6] text-fd-muted-foreground">{children}</p>
		</>
	);

	if (href) {
		return (
			<a className={className} href={href}>
				{body}
			</a>
		);
	}

	return <article className={className}>{body}</article>;
}

export function Fork({ children }: { children: ReactNode }) {
	return (
		<div className="not-prose my-8 grid grid-cols-1 border-t border-s border-fd-border md:grid-cols-2">{children}</div>
	);
}

export function ForkYes({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="border-e border-b border-fd-border p-5 md:p-6">
			<StudioKicker className="text-[#2f7d56] dark:text-[#7dbe9a]">USE THIS</StudioKicker>
			<h3 className="mt-3 mb-4 font-display text-[1.15rem] font-semibold">{title}</h3>
			<ul className="m-0 grid list-none gap-2.5 p-0 text-[0.82rem] leading-[1.55] text-fd-muted-foreground [&>li]:relative [&>li]:ps-4 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[0.7em] [&>li]:before:h-px [&>li]:before:w-2 [&>li]:before:bg-[#2f7d56] [&>li]:before:content-['']">
				{children}
			</ul>
		</section>
	);
}

export function ForkNo({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="border-e border-b border-fd-border bg-fd-card/45 p-5 md:p-6">
			<StudioKicker>NOT THIS</StudioKicker>
			<h3 className="mt-3 mb-4 font-display text-[1.15rem] font-semibold">{title}</h3>
			<ul className="m-0 grid list-none gap-2.5 p-0 text-[0.82rem] leading-[1.55] text-fd-muted-foreground [&>li]:relative [&>li]:ps-4 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[0.7em] [&>li]:before:h-px [&>li]:before:w-2 [&>li]:before:bg-vetta-coral [&>li]:before:content-['']">
				{children}
			</ul>
		</section>
	);
}

export function ForkPane({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
	return (
		<section className="border-e border-b border-fd-border p-5 md:p-6">
			<StudioKicker>{kicker}</StudioKicker>
			<h3 className="mt-3 mb-4 font-display text-[1.15rem] font-semibold">{title}</h3>
			<ul className="m-0 grid list-none gap-2.5 p-0 text-[0.82rem] leading-[1.55] text-fd-muted-foreground [&>li]:relative [&>li]:ps-4 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[0.7em] [&>li]:before:h-px [&>li]:before:w-2 [&>li]:before:bg-vetta-coral [&>li]:before:content-['']">
				{children}
			</ul>
		</section>
	);
}

export function Plate({ no, title, children }: { no: string; title: string; children: ReactNode }) {
	return (
		<figure className="not-prose my-8 overflow-hidden rounded-[10px] border border-fd-border bg-vetta-binding text-vetta-binding-fg">
			<figcaption className="flex items-baseline justify-between gap-4 border-b border-white/12 px-4 py-3">
				<StudioKicker className="text-vetta-coral">PLATE {no}</StudioKicker>
				<strong className="font-display text-[0.92rem] font-semibold">{title}</strong>
			</figcaption>
			<div className="px-1 py-1 text-[0.8rem] leading-[1.7] [&_figure]:m-0 [&_figure]:rounded-none [&_figure]:border-0 [&_figure]:bg-transparent [&_figure]:shadow-none [&_pre]:m-0 [&_pre]:bg-transparent [&_pre]:p-4">
				{children}
			</div>
		</figure>
	);
}

export function Signals({ children, language = "zh" }: { children: ReactNode; language?: DocsLanguage }) {
	return (
		<div className="not-prose my-8 border-t border-fd-border">
			<div className="grid grid-cols-[minmax(0,0.8fr)_1.1fr_1.1fr] border-b-2 border-vetta-ink bg-fd-card/70 px-0 font-mono text-[0.64rem] tracking-[0.1em] text-fd-muted-foreground uppercase max-md:hidden dark:border-vetta-ink">
				<span className="px-4 py-2.5">{language === "en" ? "Signal" : "信号"}</span>
				<span className="border-s border-fd-border px-4 py-2.5">{language === "en" ? "Healthy" : "正常"}</span>
				<span className="border-s border-fd-border px-4 py-2.5">{language === "en" ? "Needs attention" : "需要介入"}</span>
			</div>
			{children}
		</div>
	);
}

export function Signal({ name, ok, bad, language = "zh" }: { name: string; ok: string; bad: string; language?: DocsLanguage }) {
	return (
		<div className="grid grid-cols-1 border-b border-fd-border md:grid-cols-[minmax(0,0.8fr)_1.1fr_1.1fr]">
			<strong className="px-4 py-3.5 font-display text-[0.95rem] font-semibold">{name}</strong>
			<span className="px-4 py-3.5 text-[0.8rem] leading-[1.55] text-fd-muted-foreground md:border-s md:border-fd-border">
				<span className="mb-1 block font-mono text-[0.6rem] tracking-[0.1em] text-vetta-coral uppercase md:hidden">
					{language === "en" ? "Healthy" : "正常"}
				</span>
				{ok}
			</span>
			<span className="bg-vetta-coral/[0.05] px-4 py-3.5 text-[0.8rem] leading-[1.55] md:border-s md:border-fd-border">
				<span className="mb-1 block font-mono text-[0.6rem] tracking-[0.1em] text-vetta-coral uppercase md:hidden">
					{language === "en" ? "Needs attention" : "需要介入"}
				</span>
				{bad}
			</span>
		</div>
	);
}

export function Compare({
	leftTitle,
	rightTitle,
	children,
	language = "zh",
}: {
	leftTitle: string;
	rightTitle: string;
	children: ReactNode;
	language?: DocsLanguage;
}) {
	return (
		<div className="not-prose my-8 border-t border-fd-border">
			<div className="grid grid-cols-1 border-b-2 border-vetta-ink md:grid-cols-[7.2rem_1fr_1fr]">
				<span className="hidden md:block" />
				<span className="hidden px-4 py-3 font-display text-[0.95rem] font-semibold md:block">{leftTitle}</span>
				<span className="hidden bg-vetta-coral/[0.1] px-4 py-3 font-display text-[0.95rem] font-semibold md:block">
					{rightTitle}
				</span>
			</div>
			{children}
		</div>
	);
}

export function CompareRow({ label, left, right, language = "zh" }: { label: string; left: string; right: string; language?: DocsLanguage }) {
	return (
		<div className="grid grid-cols-1 border-b border-fd-border md:grid-cols-[7.2rem_1fr_1fr]">
			<span className="px-4 py-3 font-mono text-[0.64rem] tracking-[0.08em] text-vetta-coral md:px-0 md:py-3.5">
				{label}
			</span>
			<span className="px-4 py-2.5 text-[0.82rem] leading-[1.55] text-fd-muted-foreground md:py-3.5">
				<span className="mb-1 block font-mono text-[0.6rem] tracking-[0.08em] text-fd-muted-foreground uppercase md:hidden">
					{language === "en" ? "Regular chat" : "普通对话"}
				</span>
				{left}
			</span>
			<span className="bg-vetta-coral/[0.05] px-4 py-2.5 text-[0.82rem] leading-[1.55] md:py-3.5">
				<span className="mb-1 block font-mono text-[0.6rem] tracking-[0.08em] text-vetta-coral uppercase md:hidden">
					Vetta
				</span>
				{right}
			</span>
		</div>
	);
}

export function Beats({ children }: { children: ReactNode }) {
	return (
		<div className="not-prose my-6 max-w-[40rem]">
			<ol className="docs-beats m-0 list-none border-t border-fd-border p-0">{children}</ol>
		</div>
	);
}

export function Checklist({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<section className="not-prose my-8 border border-fd-border bg-fd-card/30">
			{title ? <StudioKicker className="border-b border-fd-border px-5 py-3">{title}</StudioKicker> : null}
			<ol className="docs-checks m-0 grid list-none gap-0 p-0">{children}</ol>
		</section>
	);
}

export function Panel({ children }: { children: ReactNode }) {
	return (
		<div className="not-prose my-8 grid grid-cols-1 overflow-hidden rounded-[10px] border border-fd-border md:grid-cols-2">
			{children}
		</div>
	);
}

export function PanelGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="border-b border-fd-border md:border-e md:border-b-0 md:[&:nth-child(2)]:border-e-0">
			<h3 className="m-0 border-b border-fd-border bg-fd-card/70 px-5 py-3 font-mono text-[0.64rem] font-medium tracking-[0.12em] text-vetta-coral uppercase">
				{title}
			</h3>
			<div>{children}</div>
		</section>
	);
}

export function PanelItem({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-1 border-b border-fd-border px-5 py-[0.85rem] last:border-b-0 sm:grid-cols-[minmax(7.2rem,0.42fr)_1fr] sm:gap-4 sm:items-baseline">
			<strong className="text-[0.82rem] font-semibold">{title}</strong>
			<span className="text-[0.78rem] leading-[1.55] text-fd-muted-foreground">{children}</span>
		</div>
	);
}

export function Continue({ children, language = "zh" }: { children: ReactNode; language?: DocsLanguage }) {
	return (
		<nav className="not-prose mt-14 border-t border-fd-border pt-8" aria-label={language === "en" ? "Next steps" : "下一页"}>
			<StudioKicker className="mb-5">{language === "en" ? "NEXT / CONTINUE" : "NEXT / 下一页"}</StudioKicker>
			<div className="grid grid-cols-1 border-t border-s border-fd-border sm:grid-cols-2 lg:grid-cols-3">{children}</div>
		</nav>
	);
}

export function ContinueLink({ href, title, description }: { href: string; title: string; description: string }) {
	return (
		<a
			className="group grid min-h-[8.75rem] content-between border-e border-b border-fd-border p-5 text-inherit no-underline transition-colors hover:bg-vetta-coral/[0.08]"
			href={href}
		>
			<span className="font-display text-[1.12rem] font-semibold leading-[1.3] text-pretty">{title}</span>
			<span className="mt-8 flex items-end justify-between gap-3">
				<small className="text-[0.74rem] leading-[1.5] text-fd-muted-foreground">{description}</small>
				<b className="text-[0.95rem] font-normal text-vetta-coral transition-transform duration-150 group-hover:translate-x-1" aria-hidden="true">
					→
				</b>
			</span>
		</a>
	);
}

export function DocsCallout({
	type = "info",
	title,
	children,
	className,
	...props
}: {
	type?: FieldNoteTone;
	title?: ReactNode;
	children?: ReactNode;
} & ComponentProps<"aside">) {
	const alert = fieldNoteIsAlert(type);

	return (
		<aside
			className={cn(
				"not-prose my-8 grid gap-2 border-s-2 ps-5",
				alert ? "border-vetta-coral" : "border-vetta-ink/35 dark:border-vetta-ink/45",
				className,
			)}
			{...props}
		>
			<StudioKicker>{fieldNoteLabel(type)}</StudioKicker>
			{title ? <p className="m-0 font-display text-[1.05rem] font-semibold leading-[1.4]">{title}</p> : null}
			<div className="text-[0.92rem] leading-[1.75] text-fd-muted-foreground [&_p]:m-0 [&_p+p]:mt-3 [&_a]:text-inherit [&_a]:underline [&_a]:decoration-vetta-coral/55 [&_code]:rounded-[3px] [&_code]:border [&_code]:border-fd-border [&_code]:bg-fd-card [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.87em]">
				{children}
			</div>
		</aside>
	);
}

export function DocsCards({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("not-prose my-8 grid grid-cols-1 border-t border-s border-fd-border sm:grid-cols-2", className)}
			{...props}
		>
			{children}
		</div>
	);
}

export function DocsCard({
	title,
	description,
	href,
	icon,
	className,
	children,
	...props
}: {
	title: ReactNode;
	description?: ReactNode;
	href?: string;
	icon?: ReactNode;
	children?: ReactNode;
	className?: string;
} & Omit<ComponentProps<"a">, "title">) {
	const classNames = cn(
		"group grid min-h-[8.5rem] content-start gap-2 border-e border-b border-fd-border p-5 text-inherit no-underline transition-colors",
		href && "hover:bg-vetta-coral/[0.08]",
		className,
	);

	const body = (
		<>
			{icon ? <span className="text-vetta-coral">{icon}</span> : null}
			<span className="font-display text-[1.05rem] font-semibold leading-[1.35]">{title}</span>
			{description ? (
				<span className="text-[0.78rem] leading-[1.6] text-fd-muted-foreground">{description}</span>
			) : null}
			{children ? <div className="text-[0.78rem] leading-[1.6] text-fd-muted-foreground">{children}</div> : null}
			{href ? (
				<span className="mt-auto pt-4 font-mono text-[0.64rem] tracking-[0.1em] text-vetta-coral transition-transform duration-150 group-hover:translate-x-1">
					CONTINUE →
				</span>
			) : null}
		</>
	);

	if (href) {
		return (
			<a href={href} data-card className={classNames} {...props}>
				{body}
			</a>
		);
	}

	return (
		<div data-card className={classNames}>
			{body}
		</div>
	);
}
