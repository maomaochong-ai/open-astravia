/**
 * 界面字体：
 * - system：沿用 `styles.css` 里的默认栈（-apple-system / SF Pro Text …）
 * - rounded：系统圆体（macOS 有 SF Pro Rounded，Windows 落回 Segoe UI Variable）
 * - serif：衬线（读长文更松弛，中英文各取一套本地字体）
 * - mono：等宽（把整界面当终端看，字号不变，只换字形）
 *
 * 只替换 `--font-sans` 这一个设计令牌，不改字号、不改间距，所以不会牵动任何布局。
 * 主题（色彩）不设置该令牌，故主题切换不会把用户选的字体顶掉。
 */
export type UiFontFamily = "system" | "rounded" | "serif" | "mono";

export const UI_FONT_STORAGE_KEY = "astravia-ui-font";

export const DEFAULT_UI_FONT: UiFontFamily = "system";

/**
 * 每一档的字体栈。system 用 null 表示「不写内联变量」，把令牌交还给 styles.css 的默认值，
 * 这样系统 UI 字体的优先级仍由样式表那一处决定。
 */
const FONT_STACKS: Record<UiFontFamily, string | null> = {
	system: null,
	rounded:
		'"SF Pro Rounded", ui-rounded, "Segoe UI Variable Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
	serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", "SimSun", serif',
	mono: '"SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "PingFang SC", monospace',
};

export function isUiFontFamily(value: string | null | undefined): value is UiFontFamily {
	return value === "system" || value === "rounded" || value === "serif" || value === "mono";
}

export function getStoredUiFont(): UiFontFamily {
	const stored = localStorage.getItem(UI_FONT_STORAGE_KEY);
	return isUiFontFamily(stored) ? stored : DEFAULT_UI_FONT;
}

export function applyUiFont(family: UiFontFamily): void {
	const root = document.documentElement;
	root.dataset.uiFont = family;
	const stack = FONT_STACKS[family];
	if (stack === null) {
		root.style.removeProperty("--font-sans");
		return;
	}
	root.style.setProperty("--font-sans", stack);
}

export function setStoredUiFont(family: UiFontFamily): void {
	localStorage.setItem(UI_FONT_STORAGE_KEY, family);
	applyUiFont(family);
}

export function applyStoredUiFont(): void {
	applyUiFont(getStoredUiFont());
}

/** 字体栈取值供测试与选择器预览使用；system 返回 null。 */
export function uiFontStack(family: UiFontFamily): string | null {
	return FONT_STACKS[family];
}
