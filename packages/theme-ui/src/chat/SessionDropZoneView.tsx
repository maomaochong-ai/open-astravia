import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, JSX, ReactNode } from "react";

const SOFT = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

export type SessionDropDragKind = "files" | "internal";

export interface SessionDropZoneViewLabels {
	releaseToRef: string;
	internalRef: string;
	externalRef: string;
}

export interface SessionDropZoneViewProps {
	/** Should be the same box as the visual input card (padding/max-width outside). */
	className?: string;
	style?: CSSProperties;
	children: ReactNode;
	dragKind: SessionDropDragKind | null;
	enabled: boolean;
	labels: SessionDropZoneViewLabels;
	onDragEnter: (e: React.DragEvent) => void;
	onDragOver: (e: React.DragEvent) => void;
	onDragLeave: (e: React.DragEvent) => void;
	onDrop: (e: React.DragEvent) => void;
}

/**
 * Drag-and-drop shell whose overlay matches this element's box (use on the input card).
 */
export function SessionDropZoneView({
	className,
	style,
	children,
	dragKind,
	enabled,
	labels,
	onDragEnter,
	onDragOver,
	onDragLeave,
	onDrop,
}: SessionDropZoneViewProps): JSX.Element {
	return (
		<div
			data-vetta-drop-scope="input"
			className={className}
			style={style}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			{children}
			<AnimatePresence>
				{dragKind && enabled && (
					<motion.div
						key="drop-overlay"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={SOFT}
						className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-1.5 rounded-[inherit] border border-dashed border-primary/25 bg-primary/5"
					>
						<span className="icon-[mdi--file-arrow-up-down-outline] h-6 w-6 text-primary/70" />
						<div className="text-[12px] font-medium text-primary/90">{labels.releaseToRef}</div>
						<div className="text-[11px] text-muted-foreground">
							{dragKind === "internal" ? labels.internalRef : labels.externalRef}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
