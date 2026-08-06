import type { ThemeColorTokens } from "@vetta/theme-sdk/appearance";

// 主题 token 定义。键名对应 styles.css 中 [data-mode] 块下的 CSS 变量名。
// 任意新增主题必须实现 TokenSet 完整字段，TS 会强制校验。

export interface TokenSet extends ThemeColorTokens {
	// 字体
	fontSans: string;
	fontSerif: string;
	fontMono: string;

	// 圆角
	radius: string;

	// 阴影
	shadow2xs: string;
	shadowXs: string;
	shadowSm: string;
	shadow: string;
	shadowMd: string;
	shadowLg: string;
	shadowXl: string;
	shadow2xl: string;
}

export interface ThemeDef {
	id: string;
	label: string;
	light: TokenSet;
	dark: TokenSet;
}

// TokenSet 字段名 → CSS 变量名 的映射。
// 注入时按这张表把 TokenSet 写到 documentElement.style。
export const TOKEN_CSS_VAR: Record<keyof TokenSet, string> = {
	background: "--background",
	foreground: "--foreground",
	card: "--card",
	cardForeground: "--card-foreground",
	popover: "--popover",
	popoverForeground: "--popover-foreground",
	primary: "--primary",
	primaryForeground: "--primary-foreground",
	secondary: "--secondary",
	secondaryForeground: "--secondary-foreground",
	muted: "--muted",
	mutedForeground: "--muted-foreground",
	accent: "--accent",
	accentForeground: "--accent-foreground",
	destructive: "--destructive",
	destructiveForeground: "--destructive-foreground",
	border: "--border",
	input: "--input",
	inputBarBg: "--input-bar-bg",
	ring: "--ring",
	chart1: "--chart-1",
	chart2: "--chart-2",
	chart3: "--chart-3",
	chart4: "--chart-4",
	chart5: "--chart-5",
	fontSans: "--font-sans",
	fontSerif: "--font-serif",
	fontMono: "--font-mono",
	radius: "--radius",
	shadow2xs: "--shadow-2xs",
	shadowXs: "--shadow-xs",
	shadowSm: "--shadow-sm",
	shadow: "--shadow",
	shadowMd: "--shadow-md",
	shadowLg: "--shadow-lg",
	shadowXl: "--shadow-xl",
	shadow2xl: "--shadow-2xl",
};
