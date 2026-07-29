import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「电光」主题：源自 ClickHouse 视觉语言（DESIGN.md）。
// 近纯黑画布 + 电流黄（#faff69）单点高压。深色模式严格遵循原文档，
// 浅色模式按"黄底黑字依然成立"的原则做合理映射（原文档无 light surface）。

export const voltageTheme: ThemeDef = {
	id: "voltage",
	label: "Voltage",
	dark: {
		...defaultTheme.dark,
		background: "rgb(10, 10, 10)",
		foreground: "rgb(220, 220, 220)",
		card: "rgb(26, 26, 26)",
		cardForeground: "rgb(220, 220, 220)",
		popover: "rgb(36, 36, 36)",
		popoverForeground: "rgb(220, 220, 220)",
		primary: "rgb(250, 255, 105)",
		primaryForeground: "rgb(10, 10, 10)",
		// secondary 略深于 muted
		secondary: "rgb(14, 14, 14)",
		secondaryForeground: "rgb(220, 220, 220)",
		muted: "rgb(18, 18, 18)",
		mutedForeground: "rgb(136, 136, 136)",
		accent: "rgb(58, 58, 58)",
		accentForeground: "rgb(220, 220, 220)",
		destructive: "rgb(239, 68, 68)",
		destructiveForeground: "rgb(255, 255, 255)",
		border: "rgb(42, 42, 42)",
		input: "rgb(58, 58, 58)",
		ring: "rgb(250, 255, 105)",
		chart1: "rgb(250, 255, 105)",
		chart2: "rgb(59, 130, 246)",
		chart3: "rgb(34, 197, 94)",
		chart4: "rgb(239, 68, 68)",
		chart5: "rgb(136, 136, 136)",
	},
	light: {
		...defaultTheme.light,
		// 纯白画布 + 极浅灰 card；border 用浅暖灰，避免过重
		background: "rgb(255, 255, 255)",
		foreground: "rgb(10, 10, 10)",
		card: "rgb(250, 250, 250)",
		cardForeground: "rgb(10, 10, 10)",
		popover: "rgb(255, 255, 255)",
		popoverForeground: "rgb(10, 10, 10)",
		// 浅色模式 primary 由荧光黄降级为深古金，保证白底下文字/图标可读。
		// 原荧光黄 #faff69 保留到 chart1 作为图表强调色。
		primary: "rgb(161, 98, 7)",
		primaryForeground: "rgb(255, 255, 255)",
		// secondary 略浅于 muted
		secondary: "rgb(250, 249, 246)",
		secondaryForeground: "rgb(10, 10, 10)",
		muted: "rgb(244, 243, 239)",
		mutedForeground: "rgb(90, 90, 90)",
		accent: "rgb(228, 228, 228)",
		accentForeground: "rgb(10, 10, 10)",
		destructive: "rgb(239, 68, 68)",
		destructiveForeground: "rgb(255, 255, 255)",
		border: "rgb(230, 228, 222)",
		input: "rgb(230, 228, 222)",
		ring: "rgb(161, 98, 7)",
		chart1: "rgb(250, 255, 105)",
		chart2: "rgb(59, 130, 246)",
		chart3: "rgb(34, 197, 94)",
		chart4: "rgb(239, 68, 68)",
		chart5: "rgb(90, 90, 90)",
	},
};
