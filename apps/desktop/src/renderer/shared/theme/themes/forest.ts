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

const PRIMARY_LIGHT = "#2d5a3d";
const PRIMARY_DARK = "#4ea36a";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#08170e";

const LIGHT_BG = "#e9efe0";
const LIGHT_FG = "#1b2415";
const LIGHT_CARD = "#f7faf2";
const LIGHT_MUTED = "#dfe8d2";
const LIGHT_SECONDARY = "#d5e0c6";
const LIGHT_ACCENT = "#dbe6cd";
const LIGHT_BORDER = "#c6d2b6";
const LIGHT_INPUT = "#d9e3ca";
const LIGHT_MUTED_FG = "#4c5a41";

const DARK_BG = "#0b130a";
const DARK_FG = "#dde5d4";
const DARK_CARD = "#16210f";
const DARK_POPOVER = "#1c2a14";
const DARK_MUTED = "#101a0c";
const DARK_SECONDARY = "#202d17";
const DARK_ACCENT = "#27381d";
const DARK_BORDER = "#354a27";
const DARK_INPUT = "#3d5530";
const DARK_MUTED_FG = "#9aa793";

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
