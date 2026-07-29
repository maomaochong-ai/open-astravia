import type { AbilityDetail } from "@shared/lib/api";
import { describe, expect, it } from "vitest";
import { resolveAbilityDetailContent } from "./ability-presentation";

describe("resolveAbilityDetailContent", () => {
	const detail: AbilityDetail = {
		name: "演示插件",
		description: "中文简介",
		content: "中文正文",
		meta: [{ key: "homepage", value: "https://example.com" }],
		showcases: [{ template: "chat-thread", user_prompt: "问", assistant_reply: "答" }],
		blocks: [{ type: "callout", tone: "info", content: "默认提示" }],
		i18n: {
			en: {
				name: "Demo Plugin",
				description: "English intro",
				content: "English body",
				blocks: [{ type: "markdown", content: "English blocks" }],
			},
		},
	};

	it("命中 locale 时取覆盖块", () => {
		const got = resolveAbilityDetailContent(detail, "en");
		expect(got.name).toBe("Demo Plugin");
		expect(got.description).toBe("English intro");
		expect(got.content).toBe("English body");
		expect(got.blocks).toEqual([{ type: "markdown", content: "English blocks" }]);
	});

	it("覆盖块未提供的字段回落顶层默认语言", () => {
		// en 覆盖块没写 meta / showcases，应继续用顶层的
		const got = resolveAbilityDetailContent(detail, "en");
		expect(got.meta).toHaveLength(1);
		expect(got.showcases).toHaveLength(1);
	});

	it("未命中 locale 时全部回落顶层", () => {
		const got = resolveAbilityDetailContent(detail, "ja");
		expect(got.name).toBe("演示插件");
		expect(got.description).toBe("中文简介");
		expect(got.content).toBe("中文正文");
		expect(got.blocks).toEqual([{ type: "callout", tone: "info", content: "默认提示" }]);
	});

	it("detail 为空时不抛错且给出空值", () => {
		const got = resolveAbilityDetailContent(undefined, "zh");
		expect(got.name).toBeUndefined();
		expect(got.description).toBeUndefined();
		expect(got.content).toBe("");
		expect(got.showcases).toEqual([]);
		expect(got.blocks).toEqual([]);
		expect(got.meta).toEqual([]);
	});
});
