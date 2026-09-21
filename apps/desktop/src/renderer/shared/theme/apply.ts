import type { ThemeColorOverrides } from "@vetta-org/theme-sdk/appearance";
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

export function resolveThemeMode(mode: ThemeMode): ResolvedMode {
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
	applyTheme(resolveThemeMode(mode), themeId);
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
const VIEW_TRANSITION_MS = 620;
let transitionTimer: number | null = null;
let viewTransitionSequence = 0;

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

function animateThemeReveal(root: HTMLElement, x: number, y: number, endRadius: number): void {
	root.animate(
		[{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${endRadius}px at ${x}px ${y}px)` }],
		{
			duration: VIEW_TRANSITION_MS,
			easing: "ease-in-out",
			fill: "both",
			pseudoElement: "::view-transition-new(root)",
		},
	);
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
	const sequence = ++viewTransitionSequence;
	const transition = document.startViewTransition(() => {
		// 旧页面快照完成后再启用隔离，让 transition:none 与新主题在同一次样式计算中生效。
		root.setAttribute(TRANSITION_ATTR, "");
		fn();
	});

	// 直接动画 View Transition 伪元素，避免把坐标写成会继承到整棵 DOM 的根节点变量。
	// ready 在伪元素树创建后、首次绘制前兑现，因此圆形揭示不会闪出未裁剪的新页面。
	void transition.ready
		.then(() => {
			if (sequence === viewTransitionSequence) {
				animateThemeReveal(root, x, y, endRadius);
			}
		})
		.catch(() => {});

	const cleanup = () => {
		// 新切换会让旧 View Transition 提前结束；旧任务不能清掉新任务仍需的隔离状态。
		if (sequence === viewTransitionSequence) {
			root.removeAttribute(TRANSITION_ATTR);
		}
	};
	void transition.finished.then(cleanup, cleanup);
}
