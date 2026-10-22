import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「薄荷」主题：青绿主色 + 冷调表面。
//
// 浅色画布带一层薄荷灰（不是纯白），卡面比画布更亮，muted/secondary 依次加深；
// 深色画布是近黑的冷绿，卡面与浮层逐级提亮。
// chart 取青绿一族 + 一枚冷蓝，避免图表区域显出一块不属于主题的颜色。

const PRIMARY_LIGHT = "#297a65";
const PRIMARY_DARK = "#62c9a8";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#04150f";

const LIGHT_BG = "#eef7f3";
const LIGHT_FG = "#0f221e";
const LIGHT_CARD = "#fbfefd";
const LIGHT_MUTED = "#e4f2ec";
const LIGHT_SECONDARY = "#daeee7";
const LIGHT_ACCENT = "#dcefe9";
const LIGHT_BORDER = "#c8dfd6";
const LIGHT_INPUT = "#d3e7df";
const LIGHT_MUTED_FG = "#557069";

const DARK_BG = "#08110f";
const DARK_FG = "#e0f0ea";
const DARK_CARD = "#0f1d19";
const DARK_POPOVER = "#142420";
const DARK_MUTED = "#0c1614";
const DARK_SECONDARY = "#182722";
const DARK_ACCENT = "#1c2e28";
const DARK_BORDER = "#263f39";
const DARK_INPUT = "#2e4a43";
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
