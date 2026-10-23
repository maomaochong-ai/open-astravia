import { describe, expect, it } from "vitest";
import enSettings from "../../../shared/i18n/locales/en/settings.json";
import zhSettings from "../../../shared/i18n/locales/zh/settings.json";
import { COLOR_THEME_LABEL_KEYS, colorThemeLabelKey } from "./color-theme-label-keys";
import { THEMES } from "./themes";

// 主题 id 与文案键是两份手写清单，最容易出现的错是「加了主题但漏了译文」——
// 那样界面上会静默回落到英文 label，用户在中文界面里看到一个英文主题名。

function readPath(source: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((node, key) => {
		if (node && typeof node === "object" && key in node) {
			return (node as Record<string, unknown>)[key];
		}
		return undefined;
	}, source);
}

describe("主题文案键", () => {
	it("每个可选主题都有文案键", () => {
		for (const theme of THEMES) {
			expect(colorThemeLabelKey(theme.id), `${theme.id} 缺少文案键`).toBeDefined();
		}
	});

	it("每个文案键在中文与英文里都有译文", () => {
		for (const key of Object.values(COLOR_THEME_LABEL_KEYS)) {
			expect(readPath(zhSettings, key), `zh 缺少 ${key}`).toEqual(expect.any(String));
			expect(readPath(enSettings, key), `en 缺少 ${key}`).toEqual(expect.any(String));
		}
	});

	it("没有指向已下线主题的残留键", () => {
		const ids = new Set(THEMES.map((theme) => theme.id));
		for (const id of Object.keys(COLOR_THEME_LABEL_KEYS)) {
			expect(ids.has(id), `${id} 已不在主题列表里`).toBe(true);
		}
	});
});
