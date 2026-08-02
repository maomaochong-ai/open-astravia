import { Handle, Position } from "@xyflow/react";
import { cn } from "@vetta/ui";
import type { ContentPortDataType } from "./definitions";

interface ContentNodePortProps {
	id: string;
	label: string;
	dataType: ContentPortDataType;
	side: "left" | "right";
	/** Vertical placement as percentage of node height (0–100). */
	topPercent: number;
	/** Emphasize when the node is hovered or selected. */
	active: boolean;
}

/** Soft accent per port data type — keeps bookmarks scannable without rainbow noise. */
const TYPE_TONE: Record<ContentPortDataType, string> = {
	text: "bg-muted text-muted-foreground border-border/80",
	image: "bg-primary/12 text-primary border-primary/25",
	video: "bg-sky-500/12 text-sky-700 border-sky-500/25 dark:text-sky-300",
	audio: "bg-violet-500/12 text-violet-700 border-violet-500/25 dark:text-violet-300",
	media: "bg-amber-500/12 text-amber-800 border-amber-500/25 dark:text-amber-300",
	content: "bg-emerald-500/12 text-emerald-800 border-emerald-500/25 dark:text-emerald-300",
};

/**
 * Bookmark-style connection port.
 *
 * The React Flow `Handle` *is* the tab (not a hidden hit target under a decoy),
 * so edge endpoints and drag-to-connect stay accurate. Outer tip uses a diamond
 * notch so it reads as a ribbon/bookmark tongue.
 */
export function ContentNodePort({ id, label, dataType, side, topPercent, active }: ContentNodePortProps) {
	const isLeft = side === "left";

	return (
		<Handle
			type={isLeft ? "target" : "source"}
			id={id}
			position={isLeft ? Position.Left : Position.Right}
			aria-label={label}
			className={cn(
				"content-creation-port-handle !flex !h-[22px] !w-auto !min-w-[40px] !max-w-[92px] !items-center !gap-0 !border !px-2 !text-[9px] !font-medium !leading-none !shadow-sm",
				"!transform-none !rounded-none !bg-clip-padding",
				TYPE_TONE[dataType],
				isLeft
					? "!left-0 !-translate-x-[calc(100%_-_5px)] !-translate-y-1/2 !rounded-l-md !rounded-r-none !border-r-0 !pl-2.5 !justify-end"
					: "!right-0 !left-auto !translate-x-[calc(100%_-_5px)] !-translate-y-1/2 !rounded-r-md !rounded-l-none !border-l-0 !pr-2.5 !justify-start",
				active ? "!opacity-100 !shadow-md" : "!opacity-65 group-hover:!opacity-100",
				"transition-[opacity,box-shadow,background-color,transform] duration-150",
				active && (isLeft ? "!-translate-x-[calc(100%_-_3px)]" : "!translate-x-[calc(100%_-_3px)]"),
			)}
			style={{ top: `${topPercent}%` }}
		>
			{/* Outer ribbon tip */}
			<span
				className={cn(
					"pointer-events-none absolute top-1/2 size-[7px] -translate-y-1/2 rotate-45 border border-inherit bg-inherit",
					isLeft ? "left-[-3.5px] border-r-0 border-t-0" : "right-[-3.5px] border-b-0 border-l-0",
				)}
				aria-hidden
			/>
			<span className="relative z-[1] min-w-0 truncate">{label}</span>
		</Handle>
	);
}
