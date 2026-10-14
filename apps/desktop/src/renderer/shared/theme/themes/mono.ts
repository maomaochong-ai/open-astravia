import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「默认」主题：经典色板基础上把主色替换为黑/白。
// 深色模式 primary = 白，浅色模式 primary = 黑；ring 与 primary 一致。

export const monoTheme: ThemeDef = {
	id: "mono",
	label: "Default",
	dark: {
		...defaultTheme.dark,
		background: "#0f0f0f",
		muted: "rgb(24, 24, 24)",
		secondary: "#171717",
		card: "rgb(29, 29, 29)",
		// 覆盖经典偏蓝 popover/border，侧栏设置菜单等浮层保持中性灰
		popover: "rgb(28, 28, 28)",
		// 纯黑底上正文再压一档（约 82%），避免近白发飘；muted 拉开层级
		foreground: "rgb(208, 208, 208)",
		cardForeground: "rgb(208, 208, 208)",
		popoverForeground: "rgb(208, 208, 208)",
		secondaryForeground: "rgb(208, 208, 208)",
		accentForeground: "rgb(208, 208, 208)",
		mutedForeground: "rgb(128, 128, 128)",
		border: "rgb(42, 42, 42)",
		input: "rgb(48, 48, 48)",
		inputBarBg: "rgb(29, 29, 29)",
		// 强调色仍偏亮但略软于纯白，实心按钮不刺眼
		primary: "rgb(228, 228, 228)",
		primaryForeground: "rgb(8, 8, 10)",
		ring: "rgb(228, 228, 228)",
		// hover（card / popover item 的 hover:bg-accent）；须明显高于 popover(28)
		accent: "rgb(48, 48, 48)",
	},
	light: {
		...defaultTheme.light,
		// 画布背景色；card 略压深以便与 bg 分层
		background: "#faf9f9",
		card: "rgb(248, 248, 248)",
		popover: "rgb(255, 255, 255)",
		muted: "rgb(250, 250, 250)",
		// secondary 略深于 muted，便于 bg-secondary 可辨
		secondary: "#f1f0f0",
		// 边框适当加深以适配 #faf9f9 底色，层次清晰不发白
		border: "rgb(228, 228, 228)",
		input: "rgb(228, 228, 228)",
		inputBarBg: "rgb(255, 255, 255)",
		primary: "rgb(0, 0, 0)",
		primaryForeground: "rgb(255, 255, 255)",
		ring: "rgb(0, 0, 0)",
		// card hover；略深于 card，但不过重
		accent: "rgb(232, 232, 232)",
	},
};
