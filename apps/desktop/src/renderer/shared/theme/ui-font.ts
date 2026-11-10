/**
 * 字体偏好只有一个位置，选定后全局生效：界面控件、会话正文、代码块、diff、终端与代码编辑器
 * 都跟随同一个字族。`--font-sans` 与 `--font-mono` 同时写同一份字体栈，不再分「界面字体」
 * 与「代码字体」两个角色；`--font-content` 在样式表里指向 `--font-sans`，也不需要第二份选择。
 *
 * 只换字体栈，不改字号、行高与间距，所以切换字体不会牵动任何布局。主题（色彩）不设置这些
 * 令牌，主题切换不会顶掉用户选择。
 *
 */
export type UiFontFamily =
	| "system"
	| "sans"
	| "humanist"
	| "geometric"
	| "rounded"
	| "serif"
	| "reading"
	| "song"
	| "kai"
	| "hei"
	| "mono"
	| "mono-code";

export const FONT_STORAGE_KEY = "astravia-font";
/** 上一版允许手填自定义字体栈，这个键只剩清理用途。 */
const LEGACY_CUSTOM_FONT_STORAGE_KEY = "astravia-custom-font";

/** 上一版把字体拆成「界面 / 代码」两档，只为迁移旧数据保留，不再读写。 */
const LEGACY_UI_FONT_STORAGE_KEY = "astravia-ui-font";
const LEGACY_CODE_FONT_STORAGE_KEY = "astravia-code-font";
/** 更早还有独立的「消息正文」档位。 */
const LEGACY_CONTENT_FONT_STORAGE_KEY = "astravia-content-font";
const LEGACY_CONTENT_FONT_TOKEN = "--font-content";

export const DEFAULT_FONT: UiFontFamily = "system";

/** 一个设置写两个令牌，这是「全局生效」的机械保证。 */
const FONT_TOKENS = ["--font-sans", "--font-mono"] as const;

/**
 * 每一档的字体栈。system 用 null 表示「不写内联变量」，把令牌交还给 styles.css 的默认值，
 * 这样系统 UI 字体的优先级仍由样式表那一处决定。每档都带中文回退，避免中文落到异形字形。
 */
const FONT_STACKS: Record<Exclude<UiFontFamily, "system">, string> = {
	sans: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
	humanist:
		'Seravek, Optima, Candara, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
	geometric:
		'"Avenir Next", Avenir, "Century Gothic", Futura, "Trebuchet MS", "PingFang SC", "Microsoft YaHei", sans-serif',
	rounded:
		'"SF Pro Rounded", ui-rounded, "Segoe UI Variable Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
	serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", "SimSun", serif',
	reading:
		'Charter, "Iowan Old Style", Palatino, "Book Antiqua", Georgia, "Songti SC", "Noto Serif SC", "SimSun", serif',
	song: '"Songti SC", "Noto Serif SC", "Source Han Serif SC", "SimSun", "Microsoft YaHei", serif',
	kai: '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif',
	hei: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
	mono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, "Cascadia Mono", "PingFang SC", monospace',
	"mono-code": '"JetBrains Mono", "Cascadia Code", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
};

const FONT_FAMILIES = Object.keys(FONT_STACKS) as Array<Exclude<UiFontFamily, "system">>;

export function isUiFontFamily(value: string | null | undefined): value is UiFontFamily {
	if (value === "system") return true;
	return FONT_FAMILIES.includes(value as Exclude<UiFontFamily, "system">);
}

export function getStoredFont(): UiFontFamily {
	const stored = localStorage.getItem(FONT_STORAGE_KEY);
	if (isUiFontFamily(stored)) return stored;
	// 迁移：上一版只存了界面字体，就用它作为唯一字体；没有则用默认。
	const legacy = localStorage.getItem(LEGACY_UI_FONT_STORAGE_KEY);
	return isUiFontFamily(legacy) ? legacy : DEFAULT_FONT;
}

function writeStack(root: HTMLElement, token: string, stack: string | null): void {
	if (stack === null) {
		root.style.removeProperty(token);
		return;
	}
	root.style.setProperty(token, stack);
}

/** 档位对应的字体栈；system 返回 null，把令牌交还样式表里的默认值。 */
export function fontStack(family: UiFontFamily): string | null {
	if (family === "system") return null;
	return FONT_STACKS[family];
}

export function applyFont(family: UiFontFamily): void {
	const root = document.documentElement;
	root.dataset.font = family;
	const stack = fontStack(family);
	for (const token of FONT_TOKENS) writeStack(root, token, stack);
}

/** 只应用已存的值；启动时调一次。旧键在这里就地迁移到新键，之后不再参与读取。 */
export function applyStoredFont(): void {
	dropLegacyFontState();
	const family = getStoredFont();
	localStorage.setItem(FONT_STORAGE_KEY, family);
	clearLegacyFontKeys();
	applyFont(family);
}

export function setStoredFont(family: UiFontFamily): void {
	localStorage.setItem(FONT_STORAGE_KEY, family);
	clearLegacyFontKeys();
	applyFont(family);
}

/**
 * 其他窗口（快捷面板、吉祥物、引导向导）跟随主窗口的字体：这些入口没有自己的设置页，
 * 主窗口改字体只写了自己的根节点，同源 `storage` 事件是唯一的跨窗口通道。
 * 返回取消监听的函数。
 */
export function watchStoredFont(): () => void {
	const handler = (event: StorageEvent): void => {
		if (event.key !== FONT_STORAGE_KEY) return;
		applyFont(getStoredFont());
	};
	window.addEventListener("storage", handler);
	return () => window.removeEventListener("storage", handler);
}

/**
 * 旧版本会把「消息字体」写成内联 `--font-content`，也会把「代码字体」单独写成 `--font-mono`。
 * 前者会盖住「跟随界面字体」，后者会盖住新写入的字体栈，启动时一并清掉。
 */
function dropLegacyFontState(): void {
	const root = document.documentElement;
	root.style.removeProperty(LEGACY_CONTENT_FONT_TOKEN);
	delete root.dataset.contentFont;
	delete root.dataset.uiFont;
	delete root.dataset.codeFont;
	localStorage.removeItem(LEGACY_CONTENT_FONT_STORAGE_KEY);
	localStorage.removeItem(LEGACY_CUSTOM_FONT_STORAGE_KEY);
}

function clearLegacyFontKeys(): void {
	localStorage.removeItem(LEGACY_UI_FONT_STORAGE_KEY);
	localStorage.removeItem(LEGACY_CODE_FONT_STORAGE_KEY);
}
