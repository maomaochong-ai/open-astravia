import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「蜜蜂」主题：深色主色近黑 + 亮黄强调，表面偏暖。
// 浅色主色近黑，深色主色为亮黄，前景色随主色明暗切换。

const PRIMARY_LIGHT = "#0d0d0d";
const PRIMARY_DARK = "#e0c65c";
const PRIMARY_FG_LIGHT = "#ffffff";
const PRIMARY_FG_DARK = "#10110e";

export const beeTheme: ThemeDef = {
	id: "bee",
	label: "Bee",
	dark: {
		...defaultTheme.dark,
		background: "#10110e",
		foreground: "#f2f1e8",
		card: "#0f100d",
		cardForeground: "#f2f1e8",
		popover: "#0f100d",
		popoverForeground: "#f2f1e8",
		primary: PRIMARY_DARK,
		primaryForeground: PRIMARY_FG_DARK,
		secondary: "#2c2e28",
		secondaryForeground: "#f2f1e8",
		muted: "#23251f",
		mutedForeground: "#89877a",
		accent: "#30322d",
		accentForeground: "#f2f1e8",
		destructive: "#ff8a8e",
		destructiveForeground: PRIMARY_FG_LIGHT,
		border: "#47483f",
		input: "#3b3d36",
		inputBarBg: "#0f100d",
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
		primaryForeground: PRIMARY_FG_LIGHT,
		// 浅色表面渗入极浅暖黄调，与森林的冷绿调形成区分。
		secondary: "#eeece3",
		secondaryForeground: "#141414",
		muted: "#f6f5ef",
		mutedForeground: "#7a7870",
		accent: "#e7e4d6",
		accentForeground: "#141414",
		destructive: "#e04b53",
		destructiveForeground: PRIMARY_FG_LIGHT,
		border: "#d4d1c6",
		input: "#e0dccf",
		inputBarBg: "#ffffff",
		ring: PRIMARY_LIGHT,
	},
};
