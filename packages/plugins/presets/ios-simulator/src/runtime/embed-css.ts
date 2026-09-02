/**
 * 注入到 baguette 控制台里的修正样式（webview.insertCSS）。
 *
 * 它的页面是按浏览器窗口 + 自己的浅色调色板设计的，塞进 Vetta 的活动面板时有
 * 三个问题，都是实测量出来的：
 *
 * - **配色不跟随宿主**：它有三层来源，都要处理。
 *   1. 设备页所有「玻璃面」（顶栏、左右下角按钮、各种 rail 与 sheet、下拉浮层）走
 *      `#simNativeView` 上的 `--nv-*`；
 *   2. 列表页与侧栏视图走 `:root` 上的 `--bg` / `--panel` / `--text`。这一组**必须带
 *      `!important`**：页面在运行时会再注入一份 `:root`（排在注入的样式表之后），
 *      不加就会被它盖回浅色；
 *   3. 侧栏视图里还有一批写死字面量的表面（`.card-header`、`summary`、`.btn-secondary`、
 *      `.sim-tip`、fps 徽标等），不走任何变量，只能逐个覆盖。
 *   它自带的明暗切换按钮因此变成死控件，一并隐藏——面板的明暗由 Vetta 决定。
 * - **顶栏 `.top-bar` 的布局不要去动**。它高度写死 36px，且自带折叠机制（ToolbarFold）
 *   靠 `scrollWidth > clientWidth` 判断要不要把控件折进菜单。两件事都试过、都错了：
 *   加 `flex-wrap: wrap` 会让换行的第二三行甩到设备画面上，并且让折叠判定永远不成立、
 *   把所有簇全部展开；加 `overflow-x: auto` 则会建立裁剪上下文，把折叠菜单的下拉浮层
 *   整个裁掉（规范也不允许 `overflow-x: auto` 配 `overflow-y: visible`）。
 *   实测只要收起下面那簇最宽的 capture-size，它自带的折叠就能在 260px 起的所有宽度下
 *   把内容压进胶囊（溢出恒为 -2），所以这里**不设任何 overflow 或 flex 布局覆盖**。
 * - **收起工具条后设备不居中**：`.dual-pane` 的 padding 是 `4px 58px 4px 0`，那 58px 是给
 *   右缘工具条预留的留白。工具条被隐藏后留白还在，设备就整体左偏 29px。所以隐藏工具条
 *   的同时必须把这段 padding 一起去掉；反过来，工具条可见时这段留白是对的，不能动。
 * - **最宽的一簇会被裁掉一半**：顶栏最后那簇是 capture-size（`Auto`，实测 154px），窄面板
 *   下横向滚动只能让它「半露」，看起来像坏了。它控制的是截图输出尺寸，在窄面板里价值最低，
 *   低于阈值直接整簇收起，剩下的控件才能完整显示。
 * - **折叠菜单的下拉浮层会被面板边缘裁掉**：`.tb-fold-pop` 原本以 38px 的触发器为定位
 *   基准（`position: absolute` + `translateX(-50%)`），面板窄时它向左展开就伸到视口外。
 *   改成以**居中的 `.top-bar` 为基准**：把 `.tb-fold` 置为 `static`，浮层的包含块自然变成
 *   工具栏本身，再用 `left/right: 0` 让它与工具栏同宽、并中和掉那个 `translateX(-50%)`。
 *   工具栏本身永远在视口内且居中，所以浮层也就永远不会越界。它的 `top: calc(100% + 8px)`
 *   保持不动，改基准后正好落在工具栏下方 7px。
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
/** 低于这个宽度收起 capture-size 簇：它占 154px，是顶栏最宽也最容易被裁一半的一簇。 */
export const CAPTURE_SIZE_MAX_WIDTH_PX = 520;

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
/*
 * 列表页与侧栏视图的令牌。必须逐条 !important：页面在运行时会再注入一份 :root，
 * 排在这段注入样式之后，不加会被它整体盖回浅色。
 */
:root {
	--bg: ${theme.background} !important;
	--panel: ${theme.card} !important;
	--text: ${theme.foreground} !important;
	--text-muted: ${theme.mutedForeground} !important;
	--border: ${theme.border} !important;
	--border-light: ${theme.border} !important;
	--accent: ${theme.accent} !important;
	color-scheme: ${theme.dark ? "dark" : "light"} !important;
}
html, body {
	background: ${theme.background} !important;
	color: ${theme.foreground} !important;
}
/*
 * 设备页所有玻璃面共用的一套变量。改这里就等于同时改了顶栏、左右下角的浮动按钮、
 * 插件/屏幕 rail、日志与状态栏等 sheet、以及折叠菜单的浮层。
 */
#simNativeView {
	--nv-page-bg: ${theme.background} !important;
	--nv-bar-bg: ${theme.card} !important;
	--nv-bar-border: ${theme.border} !important;
	--nv-bar-shadow: none !important;
	--nv-bar-inset: none !important;
	--nv-text: ${theme.foreground} !important;
	--nv-text-muted: ${theme.mutedForeground} !important;
	--nv-text-faint: ${theme.mutedForeground} !important;
	--nv-divider: ${theme.border} !important;
	--nv-btn-hover: color-mix(in oklab, ${theme.foreground} 10%, transparent) !important;
	--nv-btn-active: color-mix(in oklab, ${theme.foreground} 18%, transparent) !important;
	--nv-fmt-track-bg: color-mix(in oklab, ${theme.foreground} 6%, transparent) !important;
	--nv-fmt-track-border: ${theme.border} !important;
	--nv-fmt-btn-text: ${theme.mutedForeground} !important;
	--nv-accent: ${theme.accent} !important;
	--nv-scrim: ${theme.dark ? "rgba(0, 0, 0, 0.55)" : "rgba(15, 23, 42, 0.32)"} !important;
}
/* 毛玻璃在纯色底上只会把边界糊掉。 */
.top-bar { backdrop-filter: none !important; }
/* 明暗已由 Vetta 决定，它自己的切换按钮点了不会有任何变化，留着只会误导。 */
#nativeThemeToggle { display: none !important; }
/*
 * 侧栏视图（左下角按钮进入）里这些表面写死了浅色字面量，不走上面任何一套变量，
 * 只能按选择器逐个覆盖。.btn-primary 不在其中——它本来就该保持强调色。
 */
.card-header,
summary,
.btn-secondary,
.cap-size-chip,
#simStreamFps,
#ascProSimulatorRoot kbd {
	background: color-mix(in oklab, ${theme.foreground} 8%, transparent) !important;
	color: ${theme.foreground} !important;
	border-color: ${theme.border} !important;
}
.sim-tip {
	background: color-mix(in oklab, ${theme.accent} 14%, transparent) !important;
	color: ${theme.foreground} !important;
	border-color: color-mix(in oklab, ${theme.accent} 38%, transparent) !important;
}
.sim-tip * { color: ${theme.foreground} !important; }
.btn:hover,
.asc-sim-button:hover {
	background: color-mix(in oklab, ${theme.foreground} 14%, transparent) !important;
}
/*
 * 下拉浮层改成以居中的 .top-bar 为定位基准，避免向左展开时被面板边缘裁掉。
 * transform 必须一并中和：它原本是相对触发器的 translateX(-50%)，换基准后会把
 * 浮层整体推偏半个工具栏宽度。
 */
.tb-fold { position: static !important; }
.tb-fold-pop {
	left: 0 !important;
	right: 0 !important;
	width: auto !important;
	max-width: none !important;
	transform: none !important;
}
/* min-content 会反过来把 .dual-pane 撑出横向滚动，沿链路放开。 */
.device-column,
.dual-pane { min-width: 0 !important; }
@media (max-width: ${RAILS_MAX_WIDTH_PX}px) {
	#nativeRightRails { display: none !important; }
	/* 那 58px 是给工具条留的；工具条收起后必须一并去掉，否则设备左偏 29px。 */
	.dual-pane { padding-right: 0 !important; }
}
@media (max-width: ${BACK_LINK_MAX_WIDTH_PX}px) {
	#nativeBackLink { display: none !important; }
}
@media (max-width: ${CAPTURE_SIZE_MAX_WIDTH_PX}px) {
	/* 整簇收起，而不是让它被横向滚动裁成半个按钮。 */
	.tb-cluster:has(.cap-size-code) { display: none !important; }
}
.dual-pane { scrollbar-width: none !important; }
.dual-pane::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
`;
}
