import type { ThemeColorOverrides } from "@vetta/theme-sdk/appearance";
import { DEFAULT_THEME_ID, getTheme, resolveThemeId } from "./themes";
import { TOKEN_CSS_VAR, type TokenSet } from "./tokens";

export type ThemeMode = "light" | "dark" | "auto";
export type ResolvedMode = "light" | "dark";

export const MODE_STORAGE_KEY = "vetta-theme";
export const THEME_STORAGE_KEY = "vetta-color-theme";

let activeThemeColorOverrides: ThemeColorOverrides | undefined;

export function setThemeColorOverrides(overrides?: ThemeColorOverrides): void {
	activeThemeColorOverrides = overrides;
}

function writeTokens(tokens: TokenSet): void {
	const style = document.documentElement.style;
	for (const key of Object.keys(TOKEN_CSS_VAR) as (keyof TokenSet)[]) {
		style.setProperty(TOKEN_CSS_VAR[key], tokens[key]);
	}
}

export function applyTheme(mode: ResolvedMode, themeId: string): void {
	const theme = getTheme(themeId);
	const baseTokens = mode === "dark" ? theme.dark : theme.light;
	const tokens: TokenSet = {
		...baseTokens,
		...activeThemeColorOverrides?.common,
		...activeThemeColorOverrides?.[mode],
	};
	const root = document.documentElement;
	root.setAttribute("data-mode", mode);
	root.setAttribute("data-theme", theme.id);
	writeTokens(tokens);
}

function getStoredResolvedMode(mode: ThemeMode): ResolvedMode {
	if (mode === "auto") {
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	}
	return mode;
}

export function applyStoredTheme(): void {
	const mode = (localStorage.getItem(MODE_STORAGE_KEY) as ThemeMode | null) ?? "dark";
	const rawThemeId = localStorage.getItem(THEME_STORAGE_KEY) ?? DEFAULT_THEME_ID;
	const themeId = resolveThemeId(rawThemeId);
	if (themeId !== rawThemeId) {
		localStorage.setItem(THEME_STORAGE_KEY, themeId);
	}
	applyTheme(getStoredResolvedMode(mode), themeId);
}

// 启动时同步调用：在 React 挂载前把主题写入 inline style，避免冷启动闪烁。
// mode = "auto" 时优先用 window.matchMedia 推测（同步、不依赖 IPC）。
export function applyInitialTheme(): void {
	applyStoredTheme();
}

const TRANSITION_CLASS = "theme-transitioning";
/**
 * 明暗切换期间打在 `<html>` 上。原生 vibrancy 由主进程翻转 nativeTheme 驱动，
 * 既动不了也进不了 View Transition 快照，会比页面动画早一步瞬变；
 * 切换期间先把毛玻璃区域改成不透明遮住它，结束后再淡回半透明（见 styles.css）。
 */
const TRANSITION_ATTR = "data-theme-transition";
const TRANSITION_MS = 180;
let transitionTimer: number | null = null;

export interface ThemeTransitionOptions {
	x?: number;
	y?: number;
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function runFallbackTransition(root: HTMLElement, fn: () => void): void {
	root.classList.add(TRANSITION_CLASS);
	root.setAttribute(TRANSITION_ATTR, "");
	fn();
	if (transitionTimer !== null) {
		window.clearTimeout(transitionTimer);
	}
	transitionTimer = window.setTimeout(() => {
		root.classList.remove(TRANSITION_CLASS);
		root.removeAttribute(TRANSITION_ATTR);
		transitionTimer = null;
	}, TRANSITION_MS);
}

// 切换主题/模式时优先使用 View Transition 做圆形揭示；不支持时回退为颜色过渡。
export function withThemeTransition(fn: () => void, options: ThemeTransitionOptions = {}): void {
	const root = document.documentElement;
	if (!("startViewTransition" in document) || prefersReducedMotion()) {
		runFallbackTransition(root, fn);
		return;
	}

	const x = options.x ?? window.innerWidth / 2;
	const y = options.y ?? window.innerHeight / 2;
	const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
	root.style.setProperty("--theme-transition-x", `${x}px`);
	root.style.setProperty("--theme-transition-y", `${y}px`);
	root.style.setProperty("--theme-transition-radius", `${endRadius}px`);
	root.setAttribute(TRANSITION_ATTR, "");
	const transition = document.startViewTransition(fn);

	void transition.finished.finally(() => {
		root.style.removeProperty("--theme-transition-x");
		root.style.removeProperty("--theme-transition-y");
		root.style.removeProperty("--theme-transition-radius");
		root.removeAttribute(TRANSITION_ATTR);
	});
}
