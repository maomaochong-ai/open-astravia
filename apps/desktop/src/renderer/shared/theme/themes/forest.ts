import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「森林」主题：绿色主色，表面自浅到深都带一层绿。
//
// 浅色刻意不用纯白画布：画布 → 卡面 → muted → secondary 四层同色相逐级变化，
// 卡片才浮得起来；画布与卡面都是 #ffffff 时，除了主色按钮之外整套主题等于不存在。
// 深色反过来：画布最深，卡面、浮层、hover 依次提亮。
// chart 取同族色相（深中浅绿 + 一枚琥珀），图表与强调色因此不会突然跳出主题。

const PRIMARY_LIGHT = "#2d5a3d";
const PRIMARY_DARK = "#4ea36a";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#08170e";

const LIGHT_BG = "#e6efe9";
const LIGHT_FG = "#16211b";
const LIGHT_CARD = "#f4f9f6";
const LIGHT_MUTED = "#dae8df";
const LIGHT_SECONDARY = "#cfdfd6";
const LIGHT_ACCENT = "#d6e6dc";
const LIGHT_BORDER = "#bfd0c6";
const LIGHT_INPUT = "#d9e3dc";
const LIGHT_MUTED_FG = "#3d5247";

const DARK_BG = "#0a120e";
const DARK_FG = "#dae4dc";
const DARK_CARD = "#121c16";
const DARK_POPOVER = "#18241d";
const DARK_MUTED = "#0e1712";
const DARK_SECONDARY = "#1c2a21";
const DARK_ACCENT = "#24342a";
const DARK_BORDER = "#2e4036";
const DARK_INPUT = "#364a3e";
const DARK_MUTED_FG = "#8d9a92";

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
