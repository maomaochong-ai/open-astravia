// 文案与代码不在同一棵别名树下（locales 在 src/shared，@shared 指向
// renderer/shared），所以这里用相对路径直接读词条文件。

import { describe, expect, it } from "vitest";
import enSettings from "../../../../shared/i18n/locales/en/settings.json";
import zhSettings from "../../../../shared/i18n/locales/zh/settings.json";
import { IM_CHANNELS } from "./im-channel-catalog";
import { getImChannelGuide, IM_CHANNEL_GUIDES } from "./im-channel-guides";

/**
 * 手册的 key 是手写的，翻译在另一个文件里——最容易发生的回归就是两边脱节：
 * 加了渠道忘了写手册，或改了 key 忘了改文案，界面上只会显示一串 key。
 */

function lookup(bundle: Record<string, unknown>, dottedKey: string): unknown {
	return dottedKey.split(".").reduce<unknown>((node, part) => {
		if (node && typeof node === "object" && part in node) {
			return (node as Record<string, unknown>)[part];
		}
		return undefined;
	}, bundle);
}

function keysOf(transport: keyof typeof IM_CHANNEL_GUIDES): string[] {
	const guide = getImChannelGuide(transport);
	return [
		guide.titleKey,
		guide.subtitleKey,
		...guide.steps.flatMap((step) => [step.titleKey, step.descKey]),
		...guide.notes.flatMap((note) => [note.titleKey, note.descKey]),
	];
}

describe("IM_CHANNEL_GUIDES", () => {
	it("每个渠道网格里的渠道都有手册", () => {
		for (const channel of IM_CHANNELS) {
			expect(IM_CHANNEL_GUIDES[channel.transport], channel.transport).toBeDefined();
		}
	});

	it("每个渠道至少有两步和一条提醒", () => {
		for (const transport of Object.keys(IM_CHANNEL_GUIDES) as (keyof typeof IM_CHANNEL_GUIDES)[]) {
			const guide = getImChannelGuide(transport);
			expect(guide.steps.length, transport).toBeGreaterThanOrEqual(2);
			expect(guide.notes.length, transport).toBeGreaterThanOrEqual(1);
		}
	});

	it.each(["zh", "en"] as const)("%s 文案覆盖全部 key", (locale) => {
		const bundle = (locale === "zh" ? zhSettings : enSettings) as unknown as Record<string, unknown>;
		for (const transport of Object.keys(IM_CHANNEL_GUIDES) as (keyof typeof IM_CHANNEL_GUIDES)[]) {
			for (const key of keysOf(transport)) {
				const value = lookup(bundle, key);
				expect(typeof value, `${locale}: ${key}`).toBe("string");
				expect(String(value).trim().length, `${locale}: ${key}`).toBeGreaterThan(0);
			}
		}
		// 入口按钮与关闭按钮的文案同样不能缺。
		for (const key of ["imGuideOpen", "imGuideClose"]) {
			expect(typeof lookup(bundle, key), `${locale}: ${key}`).toBe("string");
		}
	});

	it("步骤的图标写法统一，可复制内容不为空串", () => {
		for (const transport of Object.keys(IM_CHANNEL_GUIDES) as (keyof typeof IM_CHANNEL_GUIDES)[]) {
			for (const step of getImChannelGuide(transport).steps) {
				expect(step.icon, transport).toMatch(/^icon-\[.+\]$/);
				if ("code" in step) {
					expect(step.code.trim().length, `${transport}: ${step.titleKey}`).toBeGreaterThan(0);
				}
			}
		}
	});
});
