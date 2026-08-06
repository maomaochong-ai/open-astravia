/**
 * 侧边栏样式：
 * - classic：贴紧窗口左侧，无圆角与四周边框，仅右侧一条分隔线（默认）
 * - floating：四周留白 + 圆角 + 边框
 *
 * 具体表现由 `styles.css` 中 `:root[data-sidebar-style="classic"]` 规则实现。
 */
export type SidebarStyle = "classic" | "floating";

export const SIDEBAR_STYLE_STORAGE_KEY = "vetta-sidebar-style";

export const DEFAULT_SIDEBAR_STYLE: SidebarStyle = "classic";

export function isSidebarStyle(value: string | null | undefined): value is SidebarStyle {
	return value === "classic" || value === "floating";
}

export function getStoredSidebarStyle(): SidebarStyle {
	const stored = localStorage.getItem(SIDEBAR_STYLE_STORAGE_KEY);
	return isSidebarStyle(stored) ? stored : DEFAULT_SIDEBAR_STYLE;
}

export function applySidebarStyle(style: SidebarStyle): void {
	document.documentElement.dataset.sidebarStyle = style;
}

export function setStoredSidebarStyle(style: SidebarStyle): void {
	localStorage.setItem(SIDEBAR_STYLE_STORAGE_KEY, style);
	applySidebarStyle(style);
}

export function applyStoredSidebarStyle(): void {
	applySidebarStyle(getStoredSidebarStyle());
}
