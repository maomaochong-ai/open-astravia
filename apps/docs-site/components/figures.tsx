import { cn } from "@/lib/cn";
import type { ComponentProps, ReactNode } from "react";

export function MediaFrame({
	portrait,
	className,
	children,
	...props
}: ComponentProps<"figure"> & { portrait?: boolean }) {
	return (
		<figure
			className={cn(
				"my-8 overflow-hidden rounded-[10px] border border-fd-border bg-vetta-binding [&_img]:m-0 [&_img]:block [&_img]:h-auto [&_img]:w-full [&_figcaption]:m-0 [&_figcaption]:border-t [&_figcaption]:border-white/12 [&_figcaption]:px-4 [&_figcaption]:py-3.5 [&_figcaption]:text-[0.72rem] [&_figcaption]:leading-[1.55] [&_figcaption]:text-[#b7b9c2]",
				portrait && "max-w-[34rem]",
				className,
			)}
			{...props}
		>
			{children}
		</figure>
	);
}

export function ConceptMap({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"relative my-6 grid grid-cols-1 border-t border-s border-fd-border before:absolute before:-top-px before:left-0 before:h-0.5 before:w-full before:bg-vetta-coral md:grid-cols-2 lg:grid-cols-5 lg:before:w-1/5 [&>div]:grid [&>div]:min-h-[11.5rem] [&>div]:content-start [&>div]:border-e [&>div]:border-b [&>div]:border-fd-border [&>div]:p-5 [&>div:first-child]:bg-vetta-coral/[0.07] [&_span]:font-mono [&_span]:text-[0.64rem] [&_span]:tracking-[0.08em] [&_span]:text-vetta-coral [&_strong]:mt-8 [&_strong]:font-display [&_strong]:text-[1.02rem] [&_strong]:font-semibold [&_small]:mt-2.5 [&_small]:text-[0.72rem] [&_small]:leading-[1.55] [&_small]:text-fd-muted-foreground",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export function EvidenceGrid({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"relative my-6 grid grid-cols-1 border-t border-s border-fd-border before:absolute before:-top-px before:left-0 before:h-0.5 before:w-full before:bg-vetta-coral md:grid-cols-2 lg:grid-cols-4 lg:before:w-1/4 [&>div]:grid [&>div]:min-h-[10.5rem] [&>div]:border-e [&>div]:border-b [&>div]:border-fd-border [&>div]:p-5 [&>div:first-child]:bg-vetta-coral/[0.07] [&_span]:font-mono [&_span]:text-[0.64rem] [&_span]:tracking-[0.08em] [&_span]:text-vetta-coral [&_strong]:mt-8 [&_strong]:font-display [&_strong]:text-[1.02rem] [&_strong]:font-semibold [&_p]:mt-2.5 [&_p]:text-[0.74rem] [&_p]:leading-[1.55] [&_p]:text-fd-muted-foreground",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export function Relationship({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div className={cn("my-6 grid gap-4 [&_span]:text-[0.72rem] [&_span]:text-fd-muted-foreground", className)} {...props}>
			{children}
		</div>
	);
}

export function RelationshipRoot({ children }: { children: ReactNode }) {
	return <div className="grid gap-1.5 rounded-lg border border-fd-border bg-fd-card p-4">{children}</div>;
}

export function RelationshipChildren({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-3 [&>div]:grid [&>div]:gap-1.5 [&>div]:rounded-lg [&>div]:border [&>div]:border-fd-border [&>div]:p-4">
			{children}
		</div>
	);
}

export function BatchFlow({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"my-6 grid gap-4 rounded-lg border border-fd-border bg-fd-card p-[1.2rem] [&>div:first-child]:flex [&>div:first-child]:justify-between [&>div:first-child]:gap-4 [&>div:first-child]:text-[0.78rem]",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export function BatchTasks({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-1 gap-2.5 md:grid-cols-5 [&>span]:rounded-md [&>span]:border [&>span]:border-t-[3px] [&>span]:border-fd-border [&>span]:p-[0.8rem] [&>span]:text-[0.72rem] [&_small]:text-fd-muted-foreground">
			{children}
		</div>
	);
}

export function Lifecycle({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"my-6 flex flex-col items-stretch gap-2.5 md:flex-row [&>span]:grid [&>span]:min-w-0 [&>span]:place-items-center [&>span]:rounded-lg [&>span]:border [&>span]:border-fd-border [&>span]:bg-fd-card [&>span]:p-[0.9rem] [&>span]:text-center [&>span]:text-[0.72rem] [&>b]:self-center [&>b]:font-normal max-md:[&>b]:rotate-90",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export function DataFlow({ className, children, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"my-6 flex flex-col items-stretch gap-2.5 md:flex-row [&>div]:grid [&>div]:min-w-0 [&>div]:flex-1 [&>div]:gap-1.5 [&>div]:place-items-center [&>div]:rounded-lg [&>div]:border [&>div]:border-fd-border [&>div]:bg-fd-card [&>div]:p-[0.9rem] [&>div]:text-center [&>div]:text-[0.72rem] [&_span]:text-[0.68rem] [&_span]:text-fd-muted-foreground [&>b]:self-center [&>b]:font-normal max-md:[&>b]:rotate-90",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}
