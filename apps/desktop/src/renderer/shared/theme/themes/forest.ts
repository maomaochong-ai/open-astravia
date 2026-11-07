import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「森林」主题：绿色主色，表面自浅到深都带一层绿。
//
// 浅色刻意不用纯白画布：画布 → 卡面 → muted → secondary 四层同色相逐级变化，
// 卡片才浮得起来；画布与卡面都是 #ffffff 时，除了主色按钮之外整套主题等于不存在。
// 深色反过来：画布最深，卡面、浮层、hover 依次提亮。
// chart 取同族色相（深中浅绿 + 一枚琥珀），图表与强调色因此不会突然跳出主题。
//
// 色相往**橄榄**偏、而不是往青绿偏：森林与薄荷同属绿色系，若两者都往青绿走，
// 深色下两条侧栏只差 RGB 距离 5.8，用户会直接读成同一套主题。
//
// 亮度被测试钉成不变量（palette.test.ts）：深色画布亮度必须落在 0.011–0.02，
// 深色相邻表面 RGB 距离 ≥8，且边框对画布的对比度要够看（≥2.2）；浅色四层表面彼此 ≥12。
// 深色原先压到过 0.0056——黑到没有光感，侧栏、卡面、画布糊成一片，看不出层次；
// 浅色原先只靠“卡面比画布亮一点点”做层次，四层都落在同一档米白里，读上去像一块布。
// 所以浅色改成向下逐级压暗拉开层差；深色从 0.0088 再抬到 0.0146——只在最深处加一点
// 亮度不够，侧栏这种大面积区域仍然是黑的，要连同卡面、浮层一起抬，层差才读得出来。

const PRIMARY_LIGHT = "#2d5a3d";
const PRIMARY_DARK = "#4ea36a";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#08170e";

const LIGHT_BG = "#e4ecda";
const LIGHT_FG = "#1b2415";
const LIGHT_CARD = "#f6faf0";
const LIGHT_MUTED = "#d9e4c9";
const LIGHT_SECONDARY = "#cddaba";
const LIGHT_ACCENT = "#d3e0c2";
const LIGHT_BORDER = "#b9c9a6";
const LIGHT_INPUT = "#c8d8b4";
const LIGHT_MUTED_FG = "#42513a";

const DARK_BG = "#1f2919";
const DARK_FG = "#d7e0cc";
const DARK_CARD = "#324227";
const DARK_POPOVER = "#384b2c";
const DARK_MUTED = "#28331f";
const DARK_SECONDARY = "#3c4f2e";
const DARK_ACCENT = "#3f5430";
const DARK_BORDER = "#557342";
const DARK_INPUT = "#5f804a";
const DARK_MUTED_FG = "#9eaa97";

export const forestTheme: ThemeDef = {
	id: "forest",
	label: "Forest",
	dark: {
		...defaultTheme.dark,
		background: DARK_BG,
		foreground: DARK_FG,
		card: DARK_CARD,
		cardForeground: DARK_FG,
		popover: DARK_POPOVER,
		popoverForeground: DARK_FG,
		primary: PRIMARY_DARK,
		primaryForeground: PRIMARY_FG_DARK,
		secondary: DARK_SECONDARY,
		secondaryForeground: DARK_FG,
		muted: DARK_MUTED,
		mutedForeground: DARK_MUTED_FG,
		accent: DARK_ACCENT,
		accentForeground: DARK_FG,
		destructive: "#ff8a8e",
		destructiveForeground: "#1a0d0e",
		border: DARK_BORDER,
		input: DARK_INPUT,
		inputBarBg: DARK_CARD,
		ring: PRIMARY_DARK,
		chart1: "#5aa870",
		chart2: "#3f8a5a",
		chart3: "#94c9a2",
		chart4: "#d9b64a",
		chart5: "#7f8f85",
	},
	light: {
		...defaultTheme.light,
		background: LIGHT_BG,
		foreground: LIGHT_FG,
		card: LIGHT_CARD,
		cardForeground: LIGHT_FG,
		popover: "#ffffff",
		popoverForeground: LIGHT_FG,
		primary: PRIMARY_LIGHT,
		primaryForeground: PRIMARY_FG_LIGHT,
		secondary: LIGHT_SECONDARY,
		secondaryForeground: LIGHT_FG,
		muted: LIGHT_MUTED,
		mutedForeground: LIGHT_MUTED_FG,
		accent: LIGHT_ACCENT,
		accentForeground: LIGHT_FG,
		destructive: "#c0453f",
		destructiveForeground: "#ffffff",
		border: LIGHT_BORDER,
		input: LIGHT_INPUT,
		inputBarBg: "#ffffff",
		ring: PRIMARY_LIGHT,
		chart1: "#4e8f63",
		chart2: "#2f6f4d",
		chart3: "#8fbf9b",
		chart4: "#c9a227",
		chart5: "#7f8f85",
	},
};
