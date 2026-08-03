import { Handle, Position } from "@xyflow/react";
import { cn } from "@vetta/ui";
import type { ContentPortDataType } from "./definitions";

interface ContentNodePortProps {
	id: string;
	label: string;
	dataType: ContentPortDataType;
	side: "left" | "right";
	/** 0-based index in the stack on this side. */
	index: number;
	/** Emphasize when the node is hovered or selected. */
	active: boolean;
}

/** First port center from the node top (flow px). */
const PORT_STACK_START = 24;
/** Fixed vertical gap between consecutive port centers. */
const PORT_STACK_GAP = 30;

/**
 * Type colors for the outer connector dot.
 * `text` stays high-contrast on dark cards.
 */
const TYPE_DOT: Record<ContentPortDataType, string> = {
	text: "bg-zinc-300 dark:bg-zinc-200",
	image: "bg-primary",
	video: "bg-sky-400",
	audio: "bg-violet-400",
	media: "bg-amber-400",
	content: "bg-emerald-400",
};

export function contentNodePortTop(index: number): number {
	return PORT_STACK_START + index * PORT_STACK_GAP;
}

function PortDot({ dataType }: { dataType: ContentPortDataType }) {
	return (
		<span
			className={cn(
				"box-border size-2 shrink-0 rounded-full",
				"ring-1 ring-black/25 dark:ring-white/15",
				TYPE_DOT[dataType],
			)}
			aria-hidden
		/>
	);
}

/**
 * Side chip flush against the card: outer corners rounded, card-facing side square
 * so it reads as a tab against the shell (no inward tuck / no air gap).
 */
export function ContentNodePort({ id, label, dataType, side, index, active }: ContentNodePortProps) {
	const isLeft = side === "left";

	return (
		<Handle
			type={isLeft ? "target" : "source"}
			id={id}
			position={isLeft ? Position.Left : Position.Right}
			aria-label={label}
			className={cn(
				"content-creation-port-handle",
				"!z-20 !flex !h-[22px] !w-auto !max-w-[7.25rem] !items-center !gap-1.5",
				"!border-0 !px-1.5 !text-[10px] !font-medium !leading-none",
				"!text-muted-foreground !shadow-none !transform-none !outline-none",
				"!transition-[color] !duration-150",
				"!opacity-100 !bg-card",
				// Flush to the card edge (no gap, no tuck). Square corners on the card-facing side.
				isLeft
					? "!left-0 !-translate-x-full !-translate-y-1/2 !flex-row !rounded-l-md !rounded-r-none"
					: "!right-0 !left-auto !translate-x-full !-translate-y-1/2 !flex-row !rounded-r-md !rounded-l-none",
				active ? "!text-foreground" : "group-hover:!text-foreground",
			)}
			style={{ top: contentNodePortTop(index) }}
		>
			{isLeft ? (
				<>
					<PortDot dataType={dataType} />
					<span className="min-w-0 truncate tracking-tight">{label}</span>
				</>
			) : (
				<>
					<span className="min-w-0 truncate tracking-tight">{label}</span>
					<PortDot dataType={dataType} />
				</>
			)}
		</Handle>
	);
}
