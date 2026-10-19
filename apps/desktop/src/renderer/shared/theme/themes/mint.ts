import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「薄荷」主题：青绿主色 + 淡绿表面。
// 浅色画布偏淡绿，深色画布近黑绿；边框与输入框带青绿调。

const PRIMARY_LIGHT = "#4fa98f";
const PRIMARY_DARK = "#62c9a8";
const PRIMARY_FG = "#ffffff";

export const mintTheme: ThemeDef = {
	id: "mint",
	label: "Mint",
	dark: {
		...defaultTheme.dark,
		background: "#0b110e",
		foreground: "#eaf3ef",
		card: "#0a0f0d",
		cardForeground: "#eaf3ef",
		popover: "#0a0f0d",
		popoverForeground: "#eaf3ef",
		primary: PRIMARY_DARK,
		primaryForeground: PRIMARY_FG,
		secondary: "#232e29",
		secondaryForeground: "#eaf3ef",
		muted: "#1a2420",
		mutedForeground: "#788f85",
		accent: "#27332e",
		accentForeground: "#eaf3ef",
		destructive: "#ff8a8e",
		destructiveForeground: PRIMARY_FG,
		border: "#394a42",
		input: "#314039",
		inputBarBg: "#0a0f0d",
		ring: PRIMARY_DARK,
	},
	light: {
		...defaultTheme.light,
		background: "#f9fbf9",
		foreground: "#2f4b2d",
		card: "#ffffff",
		cardForeground: "#2f4b2d",
		popover: "#ffffff",
		popoverForeground: "#2f4b2d",
		primary: PRIMARY_LIGHT,
		primaryForeground: PRIMARY_FG,
		secondary: "#e1eee9",
		secondaryForeground: "#2f4b2d",
		muted: "#f6f6f6",
		mutedForeground: "#737f76",
		accent: "#e1eee9",
		accentForeground: "#2f4b2d",
		destructive: "#e04b53",
		destructiveForeground: PRIMARY_FG,
		border: "#afcbc1",
		input: "#d1e4dd",
		inputBarBg: "#ffffff",
		ring: PRIMARY_LIGHT,
	},
};
