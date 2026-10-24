import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「蜜蜂」主题：暖蜜色表面 + 亮黄强调。
//
// 浅色主色保持近黑（蜜黄上压白字不可读），黄色全部落在 accent / chart / 深色模式的主色上。
// 表面是米黄到暖灰的四级台阶，画布不再是纯白——否则整套主题只剩一个按钮颜色。
// 深色画布压到近黑的暖棕，卡面提亮。chart 取蜜黄同族色，深色下不刺眼。
// 深色表面往蜜金偏：与羊皮纸（赭红）刻意分色相，两套暖色主题不会混在一起。

const PRIMARY_LIGHT = "#14120c";
const PRIMARY_DARK = "#e0c65c";
const PRIMARY_FG_LIGHT = "#faf5e7";
const PRIMARY_FG_DARK = "#14120c";

const LIGHT_BG = "#fcf5da";
const LIGHT_FG = "#1e1a0e";
const LIGHT_CARD = "#fffdf4";
const LIGHT_MUTED = "#f7edd2";
const LIGHT_SECONDARY = "#f0e4c4";
const LIGHT_ACCENT = "#f7eed8";
const LIGHT_BORDER = "#ddd0ae";
const LIGHT_INPUT = "#eadeb9";
const LIGHT_MUTED_FG = "#645b4b";

const DARK_BG = "#131208";
const DARK_FG = "#f0e9d6";
const DARK_CARD = "#1e1b0b";
const DARK_POPOVER = "#24200e";
const DARK_MUTED = "#181608";
const DARK_SECONDARY = "#292412";
const DARK_ACCENT = "#322c15";
const DARK_BORDER = "#403719";
const DARK_INPUT = "#4a401f";
const DARK_MUTED_FG = "#a19678";

export const beeTheme: ThemeDef = {
	id: "bee",
	label: "Bee",
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
		chart1: "#e0c65c",
		chart2: "#c9a227",
		chart3: "#f0e9d6",
		chart4: "#a8842a",
		chart5: "#8a7f66",
	},
	light: {
		...defaultTheme.light,
		background: LIGHT_BG,
		foreground: LIGHT_FG,
		card: LIGHT_CARD,
		cardForeground: LIGHT_FG,
		popover: "#fffefa",
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
		inputBarBg: LIGHT_CARD,
		ring: "#a8842a",
		chart1: "#d9a91b",
		chart2: "#b07d0e",
		chart3: "#14120c",
		chart4: "#e0c65c",
		chart5: "#8a7f66",
	},
};
