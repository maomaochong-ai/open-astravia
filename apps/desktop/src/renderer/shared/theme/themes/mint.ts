import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「薄荷」主题：青绿主色 + 冷调表面。
//
// 浅色画布带一层薄荷灰（不是纯白），卡面比画布更亮，muted/secondary 依次加深；
// 深色画布是近黑的冷绿，卡面与浮层逐级提亮。
// chart 取青绿一族 + 一枚冷蓝，避免图表区域显出一块不属于主题的颜色。

const PRIMARY_LIGHT = "#127a6b";
const PRIMARY_DARK = "#5fd4b0";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#04150f";

const LIGHT_BG = "#e8f6f1";
const LIGHT_FG = "#0f221e";
const LIGHT_CARD = "#f4fdf9";
const LIGHT_MUTED = "#d6ece4";
const LIGHT_SECONDARY = "#c8e6dc";
const LIGHT_ACCENT = "#d0ece4";
const LIGHT_BORDER = "#b6dcd1";
const LIGHT_INPUT = "#c4e2d9";
const LIGHT_MUTED_FG = "#3f635b";

const DARK_BG = "#071411";
const DARK_FG = "#e0f0ea";
const DARK_CARD = "#0d201b";
const DARK_POPOVER = "#122a23";
const DARK_MUTED = "#091915";
const DARK_SECONDARY = "#162e27";
const DARK_ACCENT = "#1b3830";
const DARK_BORDER = "#234a40";
const DARK_INPUT = "#2a5448";
const DARK_MUTED_FG = "#82a29a";

export const mintTheme: ThemeDef = {
	id: "mint",
	label: "Mint",
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
		chart1: "#62c9a8",
		chart2: "#3d9d85",
		chart3: "#8fe0c8",
		chart4: "#4a90c0",
		chart5: "#7f9b94",
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
		chart1: "#2f8a74",
		chart2: "#17604f",
		chart3: "#6fc3ab",
		chart4: "#4a90c0",
		chart5: "#9fb3ad",
	},
};
