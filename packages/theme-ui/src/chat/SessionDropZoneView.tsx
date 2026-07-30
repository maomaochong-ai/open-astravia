import { AnimatePresence, motion } from "motion/react";
import type { JSX, ReactNode } from "react";

const SOFT = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

export type SessionDropDragKind = "files" | "internal";

export interface SessionDropZoneViewLabels {
	releaseToRef: string;
	internalRef: string;
	externalRef: string;
}

export interface SessionDropZoneViewProps {
	className?: string;
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
 * Scoped drag-and-drop shell with overlay. Host decides the concrete drop target range.
 */
export function SessionDropZoneView({
	className,
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
						className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-2"
						style={{
							background: "color-mix(in srgb, var(--primary) 8%, transparent)",
							backdropFilter: "blur(2px)",
							border: "1.5px dashed color-mix(in srgb, var(--primary) 60%, transparent)",
						}}
					>
						<span className="icon-[mdi--file-arrow-up-down-outline] h-9 w-9 text-primary" />
						<div className="text-[14px] font-medium text-primary">{labels.releaseToRef}</div>
						<div className="text-[12px] text-primary/70">
							{dragKind === "internal" ? labels.internalRef : labels.externalRef}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
