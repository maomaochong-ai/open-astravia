import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export function DocsKicker({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<p
			className={cn(
				"mb-[1.15rem] inline-flex items-center gap-[0.55rem] font-mono text-[0.7rem] font-semibold uppercase leading-[1.4] tracking-[0.14em] text-fd-muted-foreground",
				className,
			)}
		>
			<span className="size-[0.45rem] shrink-0 rounded-full bg-vetta-coral" aria-hidden="true" />
			{children}
		</p>
	);
}
