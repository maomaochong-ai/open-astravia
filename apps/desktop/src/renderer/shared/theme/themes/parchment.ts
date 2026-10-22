import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「羊皮纸」主题：陶土橙主色 + 暖纸表面。
//
// 浅色画布是米纸色，卡面更亮、muted/secondary 更深，四层都是暖色相；
// 深色画布压成暖棕黑，卡面与浮层依次提亮。
// 主色比原色板压暗一档（#b04a2c）：它要当实心按钮底色，浅橙上压白字读不清。

const PRIMARY_LIGHT = "#b04a2c";
const PRIMARY_DARK = "#e08a68";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#1e0f08";

const LIGHT_BG = "#f8f2e8";
const LIGHT_FG = "#241a13";
const LIGHT_CARD = "#fdfaf5";
const LIGHT_MUTED = "#f2e9dc";
const LIGHT_SECONDARY = "#ece0d0";
const LIGHT_ACCENT = "#eee4d6";
const LIGHT_BORDER = "#ddcebd";
const LIGHT_INPUT = "#e6d9c8";
const LIGHT_MUTED_FG = "#6f5d4e";

const DARK_BG = "#14100c";
const DARK_FG = "#f2eae0";
const DARK_CARD = "#1e1814";
const DARK_POPOVER = "#251e18";
const DARK_MUTED = "#191410";
const DARK_SECONDARY = "#2a221b";
const DARK_ACCENT = "#342b23";
const DARK_BORDER = "#41352b";
const DARK_INPUT = "#4b3e33";
const DARK_MUTED_FG = "#a89a8d";

export const parchmentTheme: ThemeDef = {
	id: "parchment",
	label: "Parchment",
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
		chart1: "#e08a68",
		chart2: "#c96442",
		chart3: "#8a6a52",
		chart4: "#e0c65c",
		chart5: "#a89a8d",
	},
	light: {
		...defaultTheme.light,
		background: LIGHT_BG,
		foreground: LIGHT_FG,
		card: LIGHT_CARD,
		cardForeground: LIGHT_FG,
		popover: "#fffdf9",
		popoverForeground: LIGHT_FG,
		primary: PRIMARY_LIGHT,
		primaryForeground: PRIMARY_FG_LIGHT,
		secondary: LIGHT_SECONDARY,
		secondaryForeground: LIGHT_FG,
		muted: LIGHT_MUTED,
		mutedForeground: LIGHT_MUTED_FG,
		accent: LIGHT_ACCENT,
		accentForeground: LIGHT_FG,
		destructive: "#b03a2e",
		destructiveForeground: "#ffffff",
		border: LIGHT_BORDER,
		input: LIGHT_INPUT,
		inputBarBg: "#fffdf9",
		ring: PRIMARY_LIGHT,
		chart1: "#b04a2c",
		chart2: "#d98b62",
		chart3: "#7a5c3e",
		chart4: "#c9a227",
		chart5: "#9c8a78",
	},
};
