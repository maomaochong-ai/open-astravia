/**
 * 注入到 baguette 控制台里的修正样式（webview.insertCSS）。
 *
 * 它的页面是按浏览器窗口 + 自己的浅色调色板设计的，塞进 Vetta 的活动面板时有
 * 三个问题，都是实测量出来的：
 *
 * - **配色不跟随宿主**：页面在 `:root` 上写死了自己的 `--bg` / `--panel` / `--text`
 *   等变量，背景实际由 `html`、`body` 和全屏 fixed 底板 `#simNativeView` 三层绘制。
 *   把宿主的语义色读出来覆盖这几层，面板才不会像贴了一块别的产品。
 * - **顶栏 `.top-bar` 不响应式**：两层 flex 都是 `nowrap`，它自带的折叠机制折不动最宽
 *   的那一簇。实测 420px 视口下容器 338px 要塞 381px，340px 下 243px 要塞 353px——
 *   越窄错得越多，且会把 `.dual-pane` 一起撑出横向滚动。
 * - **`.dual-pane` 冒出双向滚动条**：`overflow: auto` 且内容略微超出。只隐藏滚动条
 *   外观、不动 `overflow`，滚动依旧可用，横向溢出在滚动条让出宽度后也随之消失。
 *
 * 这些选择器是 baguette 的内部实现，升级后可能失配。注入失败或选择器失效都只是
 * 退回它原本的样子，不影响功能，所以调用处对错误做吞掉处理。
 */

/** 低于这个宽度收起右缘的悬浮工具条：它固定占 44px，窄面板里挤掉的是设备画面。 */
export const RAILS_MAX_WIDTH_PX = 640;
/** 低于这个宽度收起返回列表链接：它占 105px，且指向我们刻意不用的列表页。 */
export const BACK_LINK_MAX_WIDTH_PX = 560;

export interface HostTheme {
	readonly background: string;
	readonly foreground: string;
	readonly card: string;
	readonly border: string;
	readonly mutedForeground: string;
	readonly accent: string;
	readonly dark: boolean;
}

export const FALLBACK_THEME: HostTheme = {
	background: "#161616",
	foreground: "#e6e6e6",
	card: "#1e1e1e",
	border: "#2e2e2e",
	mutedForeground: "#9a9a9a",
	accent: "#4f8cff",
	dark: true,
};

export function buildEmbedCss(theme: HostTheme): string {
	return `
:root {
	--bg: ${theme.background};
	--panel: ${theme.card};
	--text: ${theme.foreground};
	--text-muted: ${theme.mutedForeground};
	--border: ${theme.border};
	--border-light: ${theme.border};
	--accent: ${theme.accent};
	color-scheme: ${theme.dark ? "dark" : "light"};
}
html, body, #simNativeView {
	background: ${theme.background} !important;
	color: ${theme.foreground} !important;
}
/* 悬浮胶囊改成宿主的卡片色；毛玻璃在纯色底上只会糊掉边界。 */
.top-bar {
	background: ${theme.card} !important;
	border-color: ${theme.border} !important;
	backdrop-filter: none !important;
}
/*
 * 顶栏的两层 flex 都要能换行。它自带的折叠机制（ToolbarFold）折不动最宽的那一簇，
 * 实测 340px 视口下容器 243px 要塞 353px 内容；只放开外层不够，必须让 .tb-controls
 * 里的 cluster 也能落到下一行。min-width: 0 沿链路放开，避免 min-content 反过来把
 * .dual-pane 撑出横向滚动。
 */
.top-bar,
.tb-controls {
	flex-wrap: wrap !important;
	min-width: 0 !important;
	justify-content: center !important;
	row-gap: 6px !important;
}
.top-bar { max-width: 100% !important; }
.device-column,
.dual-pane { min-width: 0 !important; }
@media (max-width: ${RAILS_MAX_WIDTH_PX}px) {
	#nativeRightRails { display: none !important; }
}
@media (max-width: ${BACK_LINK_MAX_WIDTH_PX}px) {
	#nativeBackLink { display: none !important; }
}
.dual-pane { scrollbar-width: none !important; }
.dual-pane::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
`;
}
