/**
 * 字体偏好分两个位置，全局生效：
 * - ui：界面字体，落 `--font-sans`，是全局字形；消息正文通过 `--font-content: var(--font-sans)`
 *   跟着一起变，不需要第二份选择。
 * - code：代码字体，落 `--font-mono`，管代码块、diff、终端、编辑器。
 *
 * 两个位置可选的字体族是同一份表；只换字体栈，不改字号、不改间距，
 * 所以不会牵动任何布局。主题（色彩）不设置这些令牌，主题切换不会顶掉用户选择。
 */
export type UiFontFamily = "system" | "rounded" | "sans" | "serif" | "song" | "kai" | "mono";

export type FontRole = "ui" | "code";

export const UI_FONT_STORAGE_KEY = "astravia-ui-font";
export const CODE_FONT_STORAGE_KEY = "astravia-code-font";

/** 历史版本的「消息字体」档位键，只为清理旧数据保留，不再读写。 */
const LEGACY_CONTENT_FONT_STORAGE_KEY = "astravia-content-font";
const LEGACY_CONTENT_FONT_TOKEN = "--font-content";

export const DEFAULT_UI_FONT: UiFontFamily = "system";
export const DEFAULT_CODE_FONT: UiFontFamily = "mono";

/**
 * 每一档的字体栈。system 用 null 表示「不写内联变量」，把令牌交还给 styles.css 的默认值，
 * 这样系统 UI 字体的优先级仍由样式表那一处决定。
 */
const FONT_STACKS: Record<UiFontFamily, string | null> = {
	system: null,
	rounded:
		'"SF Pro Rounded", ui-rounded, "Segoe UI Variable Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
	sans: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
	serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", "SimSun", serif',
	song: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "SimSun", "Microsoft YaHei", serif',
	kai: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", serif',
	mono: '"SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "PingFang SC", monospace',
};

export function isUiFontFamily(value: string | null | undefined): value is UiFontFamily {
	return (
		value === "system" ||
		value === "rounded" ||
		value === "sans" ||
		value === "serif" ||
		value === "song" ||
		value === "kai" ||
		value === "mono"
	);
}

export function getStoredUiFont(): UiFontFamily {
	const stored = localStorage.getItem(UI_FONT_STORAGE_KEY);
	return isUiFontFamily(stored) ? stored : DEFAULT_UI_FONT;
}

export function getStoredCodeFont(): UiFontFamily {
	const stored = localStorage.getItem(CODE_FONT_STORAGE_KEY);
	return isUiFontFamily(stored) ? stored : DEFAULT_CODE_FONT;
}

function writeStack(root: HTMLElement, token: string, stack: string | null): void {
	if (stack === null) {
		root.style.removeProperty(token);
		return;
	}
	root.style.setProperty(token, stack);
}

export function applyUiFont(family: UiFontFamily): void {
	const root = document.documentElement;
	root.dataset.uiFont = family;
	writeStack(root, "--font-sans", FONT_STACKS[family]);
}

export function applyCodeFont(family: UiFontFamily): void {
	const root = document.documentElement;
	root.dataset.codeFont = family;
	writeStack(root, "--font-mono", FONT_STACKS[family]);
}

export function setStoredUiFont(family: UiFontFamily): void {
	localStorage.setItem(UI_FONT_STORAGE_KEY, family);
	applyUiFont(family);
}

export function setStoredCodeFont(family: UiFontFamily): void {
	localStorage.setItem(CODE_FONT_STORAGE_KEY, family);
	applyCodeFont(family);
}

/**
 * 早先的版本允许单独给消息正文选字体，会把 `--font-content` 写成内联值。
 * 现在消息字体恒跟随界面字体，内联值会盖掉这条跟随关系，因此启动时清掉它和旧键。
 */
function dropLegacyContentFont(): void {
	const root = document.documentElement;
	root.style.removeProperty(LEGACY_CONTENT_FONT_TOKEN);
	delete root.dataset.contentFont;
	localStorage.removeItem(LEGACY_CONTENT_FONT_STORAGE_KEY);
}

export function applyStoredUiFont(): void {
	dropLegacyContentFont();
	applyUiFont(getStoredUiFont());
	applyCodeFont(getStoredCodeFont());
}

/** 字体栈取值供测试与选项预览使用；system 返回 null。 */
export function uiFontStack(family: UiFontFamily): string | null {
	return FONT_STACKS[family];
}
