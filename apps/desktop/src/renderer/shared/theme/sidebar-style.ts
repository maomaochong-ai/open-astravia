/**
 * 侧边栏只有一种形态：贴紧窗口左侧、无圆角与四周边框，仅右侧一条分隔线。
 *
 * 早先还有一个「悬浮」可选形态（四周留白 + 圆角 + 边框），设置入口已移除；
 * 这里保留一个常量标记，是因为 `styles.css` 里贴边、macOS 原生毛玻璃、沉浸式页头
 * 这几组规则都以 `:root[data-sidebar-style="classic"]` 为开关——属性固定在启动时写上，
 * 避免旧配置里残留的 `floating` 让侧边栏退回已废弃的形态。
 */
export const SIDEBAR_STYLE_ATTRIBUTE = "classic";

export function applySidebarStyle(): void {
	document.documentElement.dataset.sidebarStyle = SIDEBAR_STYLE_ATTRIBUTE;
}
