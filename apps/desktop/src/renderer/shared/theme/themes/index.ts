import type { ThemeDef } from "../tokens";
import { beeTheme } from "./bee";
import { defaultTheme } from "./default";
import { forestTheme } from "./forest";
import { mintTheme } from "./mint";
import { monoTheme } from "./mono";
import { parchmentTheme } from "./parchment";
import { sandTheme } from "./sand";

export const THEMES: ThemeDef[] = [
	monoTheme,
	sandTheme,
	beeTheme,
	forestTheme,
	mintTheme,
	parchmentTheme,
	defaultTheme,
];

export const THEME_MAP: Record<string, ThemeDef> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

export const DEFAULT_THEME_ID = "mono";

/** 已重命名/下线的主题 id，启动时映射到新 id 并写回 localStorage。 */
const THEME_ID_ALIASES: Record<string, string> = {
	// 「测试」主题曾升为 sand（原「默认」）
	test: "sand",
	// 早期版本的主题 id 曾带前缀，这里做一次映射迁移
	"qoder-forest": "forest",
	"qoder-bee": "bee",
	"qoder-mint": "mint",
	"qoder-parchment": "parchment",
};

/** 解析存储/入参中的主题 id：别名迁移 + 未知 id 回落默认。 */
export function resolveThemeId(id: string): string {
	const candidate = THEME_ID_ALIASES[id] ?? id;
	return THEME_MAP[candidate] ? candidate : DEFAULT_THEME_ID;
}

export function getTheme(id: string): ThemeDef {
	return THEME_MAP[resolveThemeId(id)] ?? monoTheme;
}
