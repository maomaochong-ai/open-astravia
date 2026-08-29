import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, type JSX, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { ResizeHandle } from "../layout/ResizeHandle";
import type { ActivityPanelFrameProps } from "./ActivityPanelFrame";

export interface ActivityPanelViewProps {
	readonly Frame: ComponentType<ActivityPanelFrameProps>;
	readonly isOpen: boolean;
	readonly isResizing: boolean;
	readonly width: number;
	readonly minWidth: number;
	readonly maxWidth: number;
	readonly narrowSheet: boolean;
	readonly bottomSheet: boolean;
	readonly tabBar: ReactNode;
	readonly tabPicker?: ReactNode;
	readonly panelContent: ReactNode;
	readonly onClose: () => void;
	readonly onResizeStart: () => void;
	/** Reports the absolute live width while the local shell follows the pointer. */
	readonly onResize: (width: number) => void;
	readonly onResizeEnd: (width: number) => void;
}

export function ActivityPanelView({
	Frame,
	isOpen,
	isResizing,
	width,
	minWidth,
	maxWidth,
	narrowSheet,
	bottomSheet,
	tabBar,
	tabPicker,
	panelContent,
	onClose,
	onResizeStart,
	onResize,
	onResizeEnd,
}: ActivityPanelViewProps): JSX.Element {
	const liveWidthRef = useRef(width);
	const [liveWidth, setLiveWidth] = useState(width);
	const [locallyResizing, setLocallyResizing] = useState(false);
	const resizeBoundsRef = useRef({ minWidth, maxWidth });
	resizeBoundsRef.current = { minWidth, maxWidth };

	const startResize = useCallback((): void => {
		liveWidthRef.current = width;
		setLiveWidth(width);
		setLocallyResizing(true);
		onResizeStart();
	}, [onResizeStart, width]);
	const resize = useCallback(
		(delta: number): void => {
			const bounds = resizeBoundsRef.current;
			const nextWidth = Math.min(
				bounds.maxWidth,
				Math.max(bounds.minWidth, liveWidthRef.current + delta),
			);
			if (nextWidth === liveWidthRef.current) return;
			liveWidthRef.current = nextWidth;
			setLiveWidth(nextWidth);
			onResize(nextWidth);
		},
		[onResize],
	);
	const endResize = useCallback((): void => {
		const finalWidth = liveWidthRef.current;
		onResizeEnd(finalWidth);
		setLocallyResizing(false);
	}, [onResizeEnd]);

	const panelBody = useMemo(
		() => (
			<>
				{(tabBar || tabPicker) && (
					<div className="group/activity-tabs relative z-20 flex shrink-0 items-end pt-1">
						{tabBar}
						{tabPicker}
					</div>
				)}
				<Frame>
					<div className="flex min-h-0 flex-1 flex-col">{panelContent}</div>
				</Frame>
			</>
		),
		[Frame, panelContent, tabBar, tabPicker],
	);
	const displayedWidth = locallyResizing ? liveWidth : width;
	const resizing = locallyResizing || isResizing;

	return (
		<>
			{!narrowSheet && (
				<aside
					style={{
						width: isOpen ? displayedWidth : 0,
						transition: resizing ? "none" : "width 0.2s ease-in-out",
					}}
					className="relative flex h-full min-h-0 shrink-0 flex-col overflow-visible"
				>
					<div
						aria-hidden={!isOpen}
						className={
							isOpen
								? "flex h-full min-h-0 flex-col opacity-100 transition-opacity duration-150"
								: "pointer-events-none flex h-full min-h-0 flex-col opacity-0 transition-opacity duration-150"
						}
						style={{ width: displayedWidth }}
					>
						{panelBody}
					</div>
					{isOpen && (
						<ResizeHandle
							side="left"
							onResizeStart={startResize}
							onResize={resize}
							onResizeEnd={endResize}
						/>
					)}
				</aside>
			)}
			<AnimatePresence>
				{bottomSheet && (
					<>
						<motion.div
							key="activity-sheet-backdrop"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.2 }}
							onClick={onClose}
							className="fixed inset-0 z-40 bg-black/25"
						/>
						<motion.div
							key="activity-sheet"
							initial={{ y: "100%" }}
							animate={{ y: 0 }}
							exit={{ y: "100%" }}
							transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
							className="fixed inset-x-0 bottom-0 top-16 z-50 flex flex-col rounded-t-2xl border-t border-border bg-background p-2 shadow-2xl shadow-black/40"
						>
							{panelBody}
						</motion.div>
					</>
				)}
			</AnimatePresence>
		</>
	);
}
