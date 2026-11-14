// 页头图标的垂直中线 → macOS 红绿灯位置。
//
// 红绿灯是原生控件，页头是 CSS 布局，两边各自写死数字，缩放、改页头高度、进出沉浸式页头
// 都会让它们错开。现在页头只管自己排版，宿主实测其中线后上报给主进程，位置只有这一个来源。

const ANCHOR_SELECTOR = "[data-titlebar-anchor]";

/**
 * 取当前可见的锚点中线（CSS px，距窗口顶）。侧边栏收起后其子树仍在文档里但带 inert，
 * 必须跳过，否则会量到一条看不见的顶栏。
 */
export function measureTitlebarCenter(root: ParentNode): number | undefined {
	for (const el of root.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR)) {
		if (el.closest("[inert]")) continue;
		const rect = el.getBoundingClientRect();
		if (rect.height === 0) continue;
		return rect.top + rect.height / 2;
	}
	return undefined;
}
