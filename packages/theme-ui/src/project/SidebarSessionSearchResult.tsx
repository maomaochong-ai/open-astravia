import { Button, cn } from "@vetta/ui";
import type { JSX } from "react";
import { Fragment, useId } from "react";
import type { SidebarSessionSearchViewItem, SidebarSessionSearchViewLabels } from "./SidebarSessionSearchView";

export function SidebarSessionSearchResult({
	item,
	labels,
}: {
	item: SidebarSessionSearchViewItem;
	labels: Pick<SidebarSessionSearchViewLabels, "pin" | "unpin">;
}): JSX.Element {
	const id = useId();
	return (
		<li className="group relative rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border/50 hover:bg-accent/50">
			{/* The row target and pin are sibling buttons, so pinning never opens the conversation. */}
			<button
				type="button"
				onClick={item.onOpen}
				aria-labelledby={`${id}-title ${id}-source ${id}-snippet`}
				aria-describedby={`${id}-time`}
				title={`${item.title}\n${item.sourceLabel}\n${item.timeTitle}`}
				className="absolute inset-0 rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
			/>
			<div className="pointer-events-none relative flex min-w-0 items-center gap-2">
				<span
					aria-hidden="true"
					className="icon-[solar--chat-round-line-linear] size-3.5 shrink-0 text-muted-foreground"
				/>
				<span id={`${id}-title`} className="min-w-0 flex-1 truncate text-[13px] font-medium">
					<HighlightedText text={item.title} ranges={item.titleHighlights} />
				</span>
				<div className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-1">
					<Button
						aria-label={item.pinned ? labels.unpin : labels.pin}
						aria-pressed={item.pinned}
						onClick={item.onTogglePin}
						size="icon-xs"
						variant="ghost"
						title={item.pinned ? labels.unpin : labels.pin}
						className={cn(
							"pointer-events-auto",
							item.pinned
								? "text-primary"
								: "text-muted-foreground/60 group-hover:text-foreground group-focus-within:text-foreground",
						)}
					>
						<span aria-hidden="true" className="icon-[solar--pin-linear] size-3.5" />
					</Button>
					<span
						id={`${id}-source`}
						className="min-w-0 truncate rounded-full border border-border/50 bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
					>
						{item.sourceLabel}
					</span>
				</div>
			</div>
			<p
				id={`${id}-snippet`}
				className="pointer-events-none relative mt-1 break-words text-[12px] leading-5 text-muted-foreground"
			>
				<HighlightedText text={item.snippet} ranges={item.snippetHighlights} />
			</p>
			<time
				id={`${id}-time`}
				dateTime={item.timeDateTime}
				aria-label={item.timeTitle}
				className="pointer-events-none relative mt-1 block text-right text-[10px] text-muted-foreground/70"
			>
				{item.timeLabel}
			</time>
		</li>
	);
}

function HighlightedText({
	text,
	ranges,
}: {
	text: string;
	ranges: SidebarSessionSearchViewItem["titleHighlights"];
}): JSX.Element {
	return (
		<>
			{ranges.map(({ start, end }, index) => (
				<Fragment key={start}>
					{text.slice(index === 0 ? 0 : ranges[index - 1].end, start)}
					<mark className="rounded-sm bg-primary/15 font-medium text-foreground">{text.slice(start, end)}</mark>
				</Fragment>
			))}
			{text.slice(ranges.at(-1)?.end ?? 0)}
		</>
	);
}
