// 主题 id → i18n 文案键。设置页、引导页、外观动作选择器与主进程侧的快照都用这一张表，
// 新增主题时只需要在这里加一行，避免四处各写一份同样的字面量。
//
// 返回值刻意保留字面量联合类型（而不是 string）：i18n 的 t() 只接受已知键，
// 一旦退回 string，拼错的主题名会在编译期静默通过。

export const COLOR_THEME_LABEL_KEYS = {
	mono: "colorThemes.mono",
	default: "colorThemes.default",
	sand: "colorThemes.sand",
	forest: "colorThemes.forest",
	bee: "colorThemes.bee",
	mint: "colorThemes.mint",
	parchment: "colorThemes.parchment",
} as const;

export type ColorThemeLabelKey = (typeof COLOR_THEME_LABEL_KEYS)[keyof typeof COLOR_THEME_LABEL_KEYS];

export function colorThemeLabelKey(id: string): ColorThemeLabelKey | undefined {
	return COLOR_THEME_LABEL_KEYS[id as keyof typeof COLOR_THEME_LABEL_KEYS];
}
