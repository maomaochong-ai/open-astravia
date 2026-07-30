import type { ThemeDef } from "../tokens";

// 「青石」主题：冷灰画布 + 青绿主色，圆角 0.375rem。
// 配色偏开发工具风格的中性灰与绿色强调，不绑定任何第三方品牌命名。

const FONT_SANS = '-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif';
const FONT_SERIF = "Georgia, serif";
const FONT_MONO = '"SF Mono", "Fira Code", monospace';

const SHADOW_2XS = "0px 1px 2px 0px hsl(0 0% 0% / 0.09)";
const SHADOW_XS = "0px 1px 2px 0px hsl(0 0% 0% / 0.09)";
const SHADOW_SM = "0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18)";
const SHADOW = "0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 1px 2px -1px hsl(0 0% 0% / 0.18)";
const SHADOW_MD = "0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 2px 4px -1px hsl(0 0% 0% / 0.18)";
const SHADOW_LG = "0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 4px 6px -1px hsl(0 0% 0% / 0.18)";
const SHADOW_XL = "0px 1px 2px 0px hsl(0 0% 0% / 0.18), 0px 8px 10px -1px hsl(0 0% 0% / 0.18)";
const SHADOW_2XL = "0px 1px 2px 0px hsl(0 0% 0% / 0.45)";

export const slateTheme: ThemeDef = {
	id: "slate",
	label: "Slate",
	dark: {
		background: "rgb(13, 17, 23)",
		foreground: "rgb(216, 222, 230)",
		card: "rgb(22, 27, 34)",
		cardForeground: "rgb(216, 222, 230)",
		popover: "rgb(22, 27, 34)",
		popoverForeground: "rgb(216, 222, 230)",
		primary: "rgb(35, 134, 54)",
		primaryForeground: "rgb(255, 255, 255)",
		// secondary 略深于 muted
		secondary: "rgb(18, 23, 30)",
		secondaryForeground: "rgb(216, 222, 230)",
		muted: "rgb(22, 27, 34)",
		mutedForeground: "rgb(132, 140, 150)",
		accent: "rgb(28, 51, 38)",
		accentForeground: "rgb(63, 185, 80)",
		destructive: "rgb(248, 81, 73)",
		destructiveForeground: "rgb(255, 255, 255)",
		border: "rgb(48, 54, 61)",
		input: "rgb(48, 54, 61)",
		inputBarBg: "rgb(22, 27, 34)",
		ring: "rgb(35, 134, 54)",
		chart1: "rgb(63, 185, 80)",
		chart2: "rgb(47, 129, 247)",
		chart3: "rgb(163, 113, 247)",
		chart4: "rgb(210, 153, 34)",
		chart5: "rgb(248, 81, 73)",
		fontSans: FONT_SANS,
		fontSerif: FONT_SERIF,
		fontMono: FONT_MONO,
		radius: "0.375rem",
		shadow2xs: SHADOW_2XS,
		shadowXs: SHADOW_XS,
		shadowSm: SHADOW_SM,
		shadow: SHADOW,
		shadowMd: SHADOW_MD,
		shadowLg: SHADOW_LG,
		shadowXl: SHADOW_XL,
		shadow2xl: SHADOW_2XL,
	},
	light: {
		background: "rgb(255, 255, 255)",
		foreground: "rgb(31, 35, 40)",
		card: "rgb(246, 248, 250)",
		cardForeground: "rgb(31, 35, 40)",
		popover: "rgb(255, 255, 255)",
		popoverForeground: "rgb(31, 35, 40)",
		primary: "rgb(31, 136, 61)",
		primaryForeground: "rgb(255, 255, 255)",
		// secondary 略浅于 muted
		secondary: "rgb(250, 251, 252)",
		secondaryForeground: "rgb(31, 35, 40)",
		muted: "rgb(246, 248, 250)",
		mutedForeground: "rgb(101, 109, 118)",
		accent: "rgb(218, 251, 225)",
		accentForeground: "rgb(26, 127, 55)",
		destructive: "rgb(207, 34, 46)",
		destructiveForeground: "rgb(255, 255, 255)",
		border: "rgb(208, 215, 222)",
		input: "rgb(208, 215, 222)",
		inputBarBg: "rgb(255, 255, 255)",
		ring: "rgb(31, 136, 61)",
		chart1: "rgb(31, 136, 61)",
		chart2: "rgb(9, 105, 218)",
		chart3: "rgb(130, 80, 223)",
		chart4: "rgb(191, 135, 0)",
		chart5: "rgb(207, 34, 46)",
		fontSans: FONT_SANS,
		fontSerif: FONT_SERIF,
		fontMono: FONT_MONO,
		radius: "0.375rem",
		shadow2xs: SHADOW_2XS,
		shadowXs: SHADOW_XS,
		shadowSm: SHADOW_SM,
		shadow: SHADOW,
		shadowMd: SHADOW_MD,
		shadowLg: SHADOW_LG,
		shadowXl: SHADOW_XL,
		shadow2xl: SHADOW_2XL,
	},
};
