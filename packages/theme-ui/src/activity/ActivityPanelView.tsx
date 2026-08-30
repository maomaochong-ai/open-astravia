import { AnimatePresence, motion } from "motion/react";
import type { ComponentType, JSX, ReactNode } from "react";
import { ResizeHandle } from "../layout/ResizeHandle";
import { isMac } from "../utils/platform";
import type { ActivityPanelFrameProps } from "./ActivityPanelFrame";

/** macOS 红绿灯预留槽位宽度（px），与 SidebarTopBar / PageHeaderFrame 保持一致。 */
const TRAFFIC_LIGHT_GUTTER = 78;

export interface ActivityPanelViewProps {
	readonly Frame: ComponentType<ActivityPanelFrameProps>;
	readonly isOpen: boolean;
	readonly isResizing: boolean;
	readonly width: number;
	readonly narrowSheet: boolean;
	readonly bottomSheet: boolean;
	readonly tabBar: ReactNode;
	readonly tabPicker?: ReactNode;
	/** 渲染在 tab 菜单行内、「+」按钮左侧的额外操作（如活动面板全屏切换）。 */
	readonly tabMenuExtra?: ReactNode;
	/** 活动面板 tab 全屏（覆盖整个窗口）时置 true，隐藏侧边栏与对话区。 */
	readonly fullscreen?: boolean;
	readonly panelContent: ReactNode;
	readonly onClose: () => void;
	readonly onResize: (delta: number) => void;
	readonly onResizeEnd?: () => void;
}

export function ActivityPanelView({
	Frame,
	isOpen,
	isResizing,
	width,
	narrowSheet,
	bottomSheet,
	tabBar,
	tabPicker,
	tabMenuExtra,
	fullscreen = false,
	panelContent,
	onClose,
	onResize,
	onResizeEnd,
}: ActivityPanelViewProps): JSX.Element {
	const panelBody = (
		<>
			{(tabBar || tabPicker || tabMenuExtra) && (
				<div
					className="group/activity-tabs relative z-0 flex shrink-0 items-end pt-1"
					style={fullscreen && isMac ? { paddingLeft: TRAFFIC_LIGHT_GUTTER } : undefined}
				>
					{/* 活动面板全屏覆盖窗口时 tab 行顶到左上角：左侧预留红绿灯槽位并作为窗口拖拽区，
					    避免「+」、全屏切换等按钮被 macOS 红绿灯盖住。 */}
					{fullscreen && isMac && (
						<div aria-hidden className="drag-region absolute inset-y-0 left-0" style={{ width: TRAFFIC_LIGHT_GUTTER }} />
					)}
					{tabBar}
					{tabMenuExtra}
					{tabPicker}
				</div>
			)}
			<Frame>
				<div className="flex min-h-0 flex-1 flex-col">{panelContent}</div>
			</Frame>
		</>
	);

	if (fullscreen) {
		return (
			<div className="fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden bg-background">
				{panelBody}
			</div>
		);
	}

	return (
		<>
			{!narrowSheet && (
				<aside
					style={{
						width: isOpen ? width : 0,
						transition: isResizing ? "none" : "width 0.2s ease-in-out",
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
						style={{ width }}
					>
						{panelBody}
					</div>
					{isOpen && <ResizeHandle side="left" onResize={onResize} onResizeEnd={onResizeEnd} />}
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
