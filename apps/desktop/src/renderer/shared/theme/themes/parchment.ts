import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「羊皮纸」主题：陶土橙主色 + 暖米表面。
// 浅色画布偏暖白，深色画布偏暖棕；边框与输入框带暖棕调。

const PRIMARY_LIGHT = "#c96442";
const PRIMARY_DARK = "#e08a68";
const PRIMARY_FG = "#ffffff";

export const parchmentTheme: ThemeDef = {
	id: "parchment",
	label: "Parchment",
	dark: {
		...defaultTheme.dark,
		background: "#151310",
		foreground: "#f1ece5",
		card: "#12100e",
		cardForeground: "#f1ece5",
		popover: "#12100e",
		popoverForeground: "#f1ece5",
		primary: PRIMARY_DARK,
		primaryForeground: PRIMARY_FG,
		secondary: "#302b26",
		secondaryForeground: "#f1ece5",
		muted: "#26221d",
		mutedForeground: "#8e8175",
		accent: "#352f2a",
		accentForeground: "#f1ece5",
		destructive: "#ff8a8e",
		destructiveForeground: PRIMARY_FG,
		border: "#4b433b",
		input: "#413a33",
		inputBarBg: "#12100e",
		ring: PRIMARY_DARK,
	},
	light: {
		...defaultTheme.light,
		background: "#fbfbfa",
		foreground: "#202116",
		card: "#ffffff",
		cardForeground: "#202116",
		popover: "#ffffff",
		popoverForeground: "#202116",
		primary: PRIMARY_LIGHT,
		primaryForeground: PRIMARY_FG,
		secondary: "#e9e8e5",
		secondaryForeground: "#202116",
		muted: "#f5f4f1",
		mutedForeground: "#6b665c",
		accent: "#ede9e2",
		accentForeground: "#202116",
		destructive: "#e04b53",
		destructiveForeground: PRIMARY_FG,
		border: "#d4cfc6",
		input: "#e5e1d9",
		inputBarBg: "#ffffff",
		ring: PRIMARY_LIGHT,
	},
};
