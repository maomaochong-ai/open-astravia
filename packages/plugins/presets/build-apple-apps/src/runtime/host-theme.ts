import { FALLBACK_THEME, type HostTheme } from "./embed-css.js";

/**
 * 读取宿主的语义色，用于把内嵌控制台染成同一套配色。
 *
 * 从插件自己的 DOM 节点上读而不是 `document.documentElement`：插件 CSS 被包进
 * 以插件根为界的 `@scope`，但自定义属性是继承下来的，从节点本身读才不依赖宿主
 * 究竟把变量定义在哪一层。读不到就回落到一组中性值，不让配色缺失挡住面板。
 */
export function readHostTheme(node: Element | null): HostTheme {
	if (!node) return FALLBACK_THEME;
	const styles = getComputedStyle(node);
	const read = (name: string, fallback: string): string => {
		const value = styles.getPropertyValue(name).trim();
		return value.length > 0 ? value : fallback;
	};
	return {
		background: read("--background", FALLBACK_THEME.background),
		foreground: read("--foreground", FALLBACK_THEME.foreground),
		card: read("--card", FALLBACK_THEME.card),
		border: read("--border", FALLBACK_THEME.border),
		mutedForeground: read("--muted-foreground", FALLBACK_THEME.mutedForeground),
		accent: read("--primary", FALLBACK_THEME.accent),
		dark: isDarkMode(),
	};
}

/** 宿主把明暗写在 `<html data-mode>` 上；没有该属性时回落到系统偏好。 */
export function isDarkMode(): boolean {
	const mode = document.documentElement.getAttribute("data-mode");
	if (mode === "dark") return true;
	if (mode === "light") return false;
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
