import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「森林」主题：绿色主色。
// 深色画布偏深绿灰，侧栏更绿；浅色画布近白，表面带极浅绿调。

const PRIMARY_LIGHT = "#4b6f5a";
const PRIMARY_DARK = "#4d9c61";
const PRIMARY_FG = "#ffffff";

export const forestTheme: ThemeDef = {
	id: "forest",
	label: "Forest",
	dark: {
		...defaultTheme.dark,
		background: "#191b1a",
		foreground: "#d9dcd9",
		card: "#222523",
		cardForeground: "#d9dcd9",
		popover: "#222523",
		popoverForeground: "#d9dcd9",
		primary: PRIMARY_DARK,
		primaryForeground: PRIMARY_FG,
		secondary: "#2d332e",
		secondaryForeground: "#d9dcd9",
		muted: "#252b26",
		mutedForeground: "#949d96",
		accent: "#363c37",
		accentForeground: "#d9dcd9",
		destructive: "#ff8a8e",
		destructiveForeground: PRIMARY_FG,
		border: "#4b554d",
		input: "#404842",
		inputBarBg: "#222523",
		ring: PRIMARY_DARK,
	},
	light: {
		...defaultTheme.light,
		background: "#ffffff",
		foreground: "#141414",
		card: "#ffffff",
		cardForeground: "#141414",
		popover: "#ffffff",
		popoverForeground: "#141414",
		primary: PRIMARY_LIGHT,
		primaryForeground: PRIMARY_FG,
		// Qoder 浅色表面为中性灰；这里在 muted/secondary/accent 中渗入
		// 极浅绿调，使森林主题在浅色下仍可辨识，同时保持克制。
		secondary: "#e8eeea",
		secondaryForeground: "#141414",
		muted: "#f2f5f3",
		mutedForeground: "#6b746f",
		accent: "#e0e8e3",
		accentForeground: "#141414",
		destructive: "#e04b53",
		destructiveForeground: PRIMARY_FG,
		border: "#c5cdc8",
		input: "#d8deda",
		inputBarBg: "#ffffff",
		ring: PRIMARY_LIGHT,
	},
};
