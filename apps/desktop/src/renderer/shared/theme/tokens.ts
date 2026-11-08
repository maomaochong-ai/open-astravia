import type { ThemeColorTokens } from "@astravia-org/theme-sdk/appearance";

// 主题 token 定义。键名对应 styles.css 中 [data-mode] 块下的 CSS 变量名。
// 任意新增主题必须实现 TokenSet 完整字段，TS 会强制校验。
// 字体不是主题 token：默认栈只写在 styles.css，用户选择由 shared/theme/ui-font.ts
// 写到同一个元素的内联样式上。若这里也写 --font-sans，主题应用就会盖掉用户选的字体。

export interface TokenSet extends ThemeColorTokens {
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
