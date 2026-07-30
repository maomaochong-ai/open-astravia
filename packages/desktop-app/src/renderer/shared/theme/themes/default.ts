import type { ThemeDef } from "../tokens";

// 与 styles.css 中原 [data-theme="dark"] / [data-theme="light"] 字节级一致。
// 这是存量用户升级后的默认外观。

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

export const defaultTheme: ThemeDef = {
	id: "default",
	label: "Classic",
	dark: {
		background: "rgb(20, 22, 30)",
		// 暗色正文约 86% 亮度：避免近白（240+）在深底上刺眼，对比仍远超 WCAG AA
		foreground: "rgb(220, 224, 234)",
		card: "rgb(26, 28, 36)",
		cardForeground: "rgb(220, 224, 234)",
		popover: "rgb(50, 53, 67)",
		popoverForeground: "rgb(220, 224, 234)",
		primary: "rgb(99, 102, 241)",
		primaryForeground: "rgb(255, 255, 255)",
		// secondary 抬升以与背景可辨（约 +16，高于 muted）；色相取中性灰，不带蓝偏
		secondary: "rgb(38, 38, 40)",
		secondaryForeground: "rgb(220, 224, 234)",
		muted: "rgb(30, 30, 32)",
		mutedForeground: "rgb(138, 144, 160)",
		accent: "rgb(41, 41, 43)",
		accentForeground: "rgb(220, 224, 234)",
		destructive: "rgb(255, 91, 91)",
		destructiveForeground: "rgb(0, 0, 0)",
		border: "rgb(42, 45, 56)",
		input: "rgb(48, 51, 64)",
		ring: "rgb(129, 132, 248)",
		chart1: "rgb(255, 174, 4)",
		chart2: "rgb(38, 113, 244)",
		chart3: "rgb(116, 116, 116)",
		chart4: "rgb(82, 82, 82)",
		chart5: "rgb(228, 228, 228)",
		fontSans: FONT_SANS,
		fontSerif: FONT_SERIF,
		fontMono: FONT_MONO,
		radius: "0.5rem",
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
		// 纯白画布 + 极浅灰 card 分层；border 不宜过重
		background: "rgb(255, 255, 255)",
		foreground: "rgb(0, 0, 0)",
		card: "rgb(250, 250, 250)",
		cardForeground: "rgb(0, 0, 0)",
		popover: "rgb(255, 255, 255)",
		popoverForeground: "rgb(0, 0, 0)",
		primary: "rgb(79, 70, 229)",
		primaryForeground: "rgb(255, 255, 255)",
		// secondary 压深以与背景可辨（约 -17，深于 muted）
		secondary: "rgb(235, 235, 235)",
		secondaryForeground: "rgb(0, 0, 0)",
		muted: "rgb(242, 242, 242)",
		mutedForeground: "rgb(82, 82, 82)",
		accent: "rgb(235, 235, 235)",
		accentForeground: "rgb(0, 0, 0)",
		destructive: "rgb(229, 75, 79)",
		destructiveForeground: "rgb(255, 255, 255)",
		border: "rgb(230, 230, 230)",
		input: "rgb(230, 230, 230)",
		ring: "rgb(79, 70, 229)",
		chart1: "rgb(255, 174, 4)",
		chart2: "rgb(45, 98, 239)",
		chart3: "rgb(164, 164, 164)",
		chart4: "rgb(228, 228, 228)",
		chart5: "rgb(116, 116, 116)",
		fontSans: FONT_SANS,
		fontSerif: FONT_SERIF,
		fontMono: FONT_MONO,
		radius: "0.5rem",
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
