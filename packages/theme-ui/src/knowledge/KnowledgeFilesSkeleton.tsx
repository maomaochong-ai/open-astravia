import type { JSX } from "react";

/**
 * First-load skeleton while disk list is pending.
 * Grid columns match KnowledgeGrid (auto-fill / 140px).
 */
export function KnowledgeFilesSkeleton(): JSX.Element {
	return (
		<div className="flex min-h-0 flex-1 px-8 pb-8">
			<div className="min-h-0 flex-1 overflow-hidden">
				<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1 py-3">
					{Array.from({ length: 18 }, (_, i) => (
						<div key={i} className="flex flex-col items-center gap-2 px-2 py-3">
							<div className="h-[72px] w-[72px] animate-pulse rounded-2xl bg-foreground/[0.06]" />
							<div className="h-2.5 w-16 animate-pulse rounded bg-foreground/[0.06]" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
