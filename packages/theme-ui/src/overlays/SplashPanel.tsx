import { cn, OVERLAY_BACKDROP_CLASS, PANEL_SHADOW_CLASS } from "@astravia-org/ui/utils";
import { AnimatePresence, motion } from "motion/react";
import { type JSX, type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";
import { ThemeSurface } from "../appearance/ThemeSurface";
import "./command-menu.css";

/**
 * 居中偏上的 Splash 面板外壳：遮罩 + 入场动效 + 高光边 + 主题 surface 槽位。
 * 「添加项目」「管理会话」这类多步面板共用这一份，外壳样式只在这里改一次。
 *
 * 自己 portal 到 body：宿主可能把它挂在侧栏之类带 transform / contain 的祖先里，
 * 那样 `fixed` 会相对祖先定位，面板就缩在侧栏里了。
 *
 * 只管外壳：头部（搜索框 / 标题）、内容与底栏都由调用方传入，键盘导航与关闭快捷键
 * 由宿主负责，本组件只处理点击遮罩关闭。
 * 面板顶部对齐而非垂直居中：内容条数会变，垂直居中会让头部随内容上下跳。
 */

export interface SplashPanelProps {
	readonly open: boolean;
	readonly onClose: () => void;
	/** 无障碍名称（对话框的 aria-label）。 */
	readonly label: string;
	/** 顶部区域，例如搜索框或标题；与内容之间由调用方自带分隔。 */
	readonly header?: ReactNode;
	readonly children: ReactNode;
	/** 底部提示栏。 */
	readonly footer?: ReactNode;
	/** 面板宽度（CSS 值），默认 640px 与命令面板一致。 */
	readonly width?: string;
}

export function SplashPanel({
	open,
	onClose,
	label,
	header,
	children,
	footer,
	width = "640px",
}: SplashPanelProps): JSX.Element {
	const overlayRef = useRef<HTMLDivElement | null>(null);

	return createPortal(
		<AnimatePresence>
			{open && (
				<motion.div
					ref={overlayRef}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.14 }}
					// 与 CommandMenuView / ConfirmDialogView 同因：portal 到 body 后需显式恢复指针事件。
					className={cn("pointer-events-auto fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]", OVERLAY_BACKDROP_CLASS)}
					onMouseDown={(event) => {
						if (event.target === overlayRef.current) onClose();
					}}
				>
					<motion.div
						role="dialog"
						aria-modal="true"
						aria-label={label}
						initial={{ opacity: 0, scale: 0.96, y: -8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.96, y: -8 }}
						transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
						style={{ width: `min(${width}, calc(100vw - 32px))` }}
						className={cn("command-menu-sheen relative flex flex-col rounded-2xl bg-popover", PANEL_SHADOW_CLASS)}
					>
						<ThemeSurface slot="root.commandMenu.panel" />
						<div className="relative z-10 flex min-h-0 flex-col">
							{header}
							{children}
							{footer}
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>,
		document.body,
	);
}
