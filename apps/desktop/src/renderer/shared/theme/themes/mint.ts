import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「薄荷」主题：青绿主色 + 冷调表面。
//
// 浅色画布带一层薄荷灰（不是纯白），卡面比画布更亮，muted/secondary 依次加深；
// 深色画布是近黑的冷绿，卡面与浮层逐级提亮。
// chart 取青绿一族 + 一枚冷蓝，避免图表区域显出一块不属于主题的颜色。
// 色相守住青绿一侧：与森林（橄榄绿）刻意分色相，两套深色侧栏 RGB 距离 18.5。

const PRIMARY_LIGHT = "#127a6b";
const PRIMARY_DARK = "#5fd4b0";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#04150f";

const LIGHT_BG = "#e4f6f4";
const LIGHT_FG = "#0f221e";
const LIGHT_CARD = "#f4fdfb";
const LIGHT_MUTED = "#d4ece8";
const LIGHT_SECONDARY = "#c6e6e1";
const LIGHT_ACCENT = "#d0ece8";
const LIGHT_BORDER = "#b4dcd6";
const LIGHT_INPUT = "#c2e2dd";
const LIGHT_MUTED_FG = "#3f635b";

const DARK_BG = "#041214";
const DARK_FG = "#e0f0ea";
const DARK_CARD = "#0d231e";
const DARK_POPOVER = "#122b24";
const DARK_MUTED = "#091b17";
const DARK_SECONDARY = "#163129";
const DARK_ACCENT = "#1c3b32";
const DARK_BORDER = "#26493f";
const DARK_INPUT = "#2d5448";
const DARK_MUTED_FG = "#86a8a1";

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
