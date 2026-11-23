import { useSyncExternalStore } from "react";

/** 主题只有两档，存 localStorage；首帧由 index.html 的内联脚本先定住。 */
export type Theme = "light" | "dark";

const THEME_KEY = "astravia-theme";

function readTheme(): Theme {
	const stored = document.documentElement.dataset.theme;
	if (stored === "light" || stored === "dark") return stored;
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 主题是站点级状态，不是某个组件的局部状态。
 *
 * 之前每个 `useTheme()` 各持一份 `useState`：页头的按钮只更新它自己那份，
 * 依赖主题换图的区块（产品截图、社群海报）根本收不到通知，于是切了主题图不变。
 * 这里改成模块级 store：一次写入，所有订阅者一起重渲染。
 */
let current: Theme = typeof document === "undefined" ? "dark" : readTheme();
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function applyTheme(next: Theme, persist: boolean) {
	current = next;
	if (typeof document !== "undefined") {
		document.documentElement.dataset.theme = next;
		document
			.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
			?.setAttribute("content", next === "dark" ? "#0d0d0d" : "#ffffff");
	}
	if (persist) {
		try {
			localStorage.setItem(THEME_KEY, next);
		} catch {
			// 隐私模式下 localStorage 可能不可写：本次会话内仍然生效。
		}
	}
	emit();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** 客户端脚本已写过一次；这里只补 meta 与系统偏好监听。 */
export function initTheme() {
	applyTheme(readTheme(), false);
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const onChange = (event: MediaQueryListEvent) => {
		if (localStorage.getItem(THEME_KEY)) return;
		applyTheme(event.matches ? "dark" : "light", false);
	};
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

export function useTheme() {
	const theme = useSyncExternalStore(
		subscribe,
		() => current,
		() => "dark" as Theme,
	);
	return {
		theme,
		toggle: () => applyTheme(current === "dark" ? "light" : "dark", true),
	};
}
