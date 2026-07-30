import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「珊瑚」主题：中性灰表面 + 珊瑚主色 #f76f53。
// dark accent 抬高以便 bg-accent 与 dropdown 的 hover:bg-accent/50 可辨；
// light secondary 用于用户消息气泡，须明显深于背景。

const PRIMARY = "rgb(247, 111, 83)"; // #f76f53
const PRIMARY_FG = "rgb(255, 255, 255)";

// ── dark ──
const DARK_BG = "rgb(32, 32, 32)"; // #202020
const DARK_MUTED = "rgb(30, 30, 30)"; // #1e1e1e
const DARK_SECONDARY = "rgb(26, 26, 26)"; // 略深于 muted
const DARK_CARD = "rgb(28, 28, 28)"; // #1c1c1c
const DARK_POPOVER = DARK_CARD;
const DARK_ACCENT = "rgb(69, 69, 69)"; // #454545
// 中性灰边框（覆盖经典主题偏蓝的 border/input）
const DARK_BORDER = "rgb(58, 58, 58)"; // #3a3a3a
const DARK_INPUT = "rgb(66, 66, 66)"; // #424242

// ── light ──
// 冷灰石色：去掉米黄偏黄感，仍保留柔和纸面层级（card > bg > muted > secondary）
const LIGHT_BG = "rgb(240, 241, 242)"; // #f0f1f2
const LIGHT_MUTED = "rgb(234, 235, 237)"; // #eaebed
const LIGHT_SECONDARY = "rgb(226, 228, 231)"; // #e2e4e7（用户气泡，明显深于背景）
const LIGHT_CARD = "rgb(246, 247, 248)"; // #f6f7f8
const LIGHT_POPOVER = LIGHT_CARD;
const LIGHT_ACCENT = "rgb(228, 230, 233)"; // #e4e6e9
const LIGHT_BORDER = "rgb(214, 216, 219)"; // #d6d8db
const LIGHT_INPUT = LIGHT_BORDER;

export const sandTheme: ThemeDef = {
	id: "sand",
	label: "Coral",
	dark: {
		...defaultTheme.dark,
		background: DARK_BG,
		muted: DARK_MUTED,
		secondary: DARK_SECONDARY,
		card: DARK_CARD,
		popover: DARK_POPOVER,
		accent: DARK_ACCENT,
		border: DARK_BORDER,
		input: DARK_INPUT,
		inputBarBg: DARK_CARD,
		primary: PRIMARY,
		primaryForeground: PRIMARY_FG,
		ring: PRIMARY,
	},
	light: {
		...defaultTheme.light,
		background: LIGHT_BG,
		muted: LIGHT_MUTED,
		secondary: LIGHT_SECONDARY,
		card: LIGHT_CARD,
		popover: LIGHT_POPOVER,
		accent: LIGHT_ACCENT,
		border: LIGHT_BORDER,
		input: LIGHT_INPUT,
		inputBarBg: "rgb(255, 255, 255)",
		primary: PRIMARY,
		primaryForeground: PRIMARY_FG,
		ring: PRIMARY,
	},
};
