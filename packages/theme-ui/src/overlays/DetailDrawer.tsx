import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@vetta/ui";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { shouldCloseDetailDrawer } from "./detail-drawer-guard";

/** 窄于此宽度改为从底部弹出：右侧抽屉占 60% 时剩余列表已不足以阅读。 */
const NARROW_VIEWPORT_QUERY = "(max-width: 768px)";

function useNarrowViewport(): boolean {
	const subscribe = useCallback((onChange: () => void) => {
		const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);
	return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW_VIEWPORT_QUERY).matches);
}

export interface DetailDrawerProps {
	readonly open: boolean;
	/** 读屏用的标题与描述；可视标题由内容自己呈现。 */
	readonly title: string;
	readonly description?: string;
	readonly onClose: () => void;
	/** 退出动画结束的通知，配合外层延迟卸载保留关闭动画。 */
	readonly onExited?: () => void;
	readonly children: ReactNode;
}

/**
 * 全应用统一的详情抽屉：宽屏右侧 60vw 滑出、窄屏底部 85vh 弹出，
 * 遮罩点击 / Esc / 路由返回都走同一条关闭路径。能力详情、智能体档案、
 * 团队设置共用这一枚壳层，改动画或尺寸只用改这里。
 */
export function DetailDrawer({
	open,
	title,
	description,
	onClose,
	onExited,
	children,
}: DetailDrawerProps): JSX.Element {
	const narrow = useNarrowViewport();
	return (
		<Drawer
			direction={narrow ? "bottom" : "right"}
			open={open}
			onAnimationEnd={(nextOpen) => {
				if (!nextOpen && !open) onExited?.();
			}}
			onOpenChange={(next) => {
				if (shouldCloseDetailDrawer(next, document)) onClose();
			}}
		>
			<DrawerContent
				overlayClassName={open ? undefined : "!pointer-events-none"}
				className="flex flex-col border-l-0 outline-none focus-visible:outline-none data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:h-[85vh] data-[vaul-drawer-direction=bottom]:max-h-[85vh] data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:max-h-screen data-[vaul-drawer-direction=right]:w-[60vw] data-[vaul-drawer-direction=right]:sm:max-w-none"
			>
				<DrawerTitle className="sr-only">{title}</DrawerTitle>
				<DrawerDescription className="sr-only">{description ?? ""}</DrawerDescription>
				{children}
			</DrawerContent>
		</Drawer>
	);
}
