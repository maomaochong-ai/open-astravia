import type { AbilityDetail, MarketAbility } from "@shared/lib/api";
import { describe, expect, it } from "vitest";
import {
	isRenderableImageIcon,
	localizeMarketAbility,
	resolveAbilityDetailContent,
	resolveCategoryLabel,
} from "./ability-presentation";

describe("isRenderableImageIcon", () => {
	it("接受内置 MCP 预设的相对路径图标", () => {
		expect(isRenderableImageIcon("./mcp/figma.png")).toBe(true);
		expect(isRenderableImageIcon("https://example.com/a.png")).toBe(true);
		expect(isRenderableImageIcon("solar:plug-circle-linear")).toBe(false);
		expect(isRenderableImageIcon("")).toBe(false);
	});

	it("接受开源市场的 vetta-file 本地图标 URL", () => {
		expect(isRenderableImageIcon("vetta-file://local/C:/Users/x/.vetta/icon.svg?v=1")).toBe(true);
	});
});

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

	// admin 手填的译文键是 en-US（服务端 SupportedLocales），界面语言只有 en：
	// 精确匹配会全量回落默认语言，即「设了双语只显示第一种」。
	it("界面语言 en 命中 admin 写入的 en-US 覆盖块", () => {
		const withRegion: AbilityDetail = {
			name: "演示插件",
			description: "中文简介",
			i18n: { "en-US": { name: "Demo Plugin", description: "English intro" } },
		};
		const got = resolveAbilityDetailContent(withRegion, "en");
		expect(got.name).toBe("Demo Plugin");
		expect(got.description).toBe("English intro");
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

describe("resolveCategoryLabel", () => {
	it("界面语言 en 命中服务端写入的 en-US 译名", () => {
		expect(resolveCategoryLabel("设计", { "en-US": "Design" }, "en")).toBe("Design");
	});

	it("无译名时回落规范名", () => {
		expect(resolveCategoryLabel("设计", { "ja-JP": "デザイン" }, "en")).toBe("设计");
		expect(resolveCategoryLabel("设计", undefined, "en")).toBe("设计");
	});
});

describe("localizeMarketAbility", () => {
	const entry: MarketAbility = {
		slug: "demo",
		type: "skill",
		name: "演示技能",
		description: "中文简介",
		license: "",
		version: "1.0.0",
		author: "",
		icon: "",
		category: "设计",
		tags: ["设计"],
		sha256: "",
		download_count: 0,
		config: {},
		detail: {
			name: "演示技能",
			description: "中文简介",
			tags: ["设计"],
			i18n: { "en-US": { name: "Demo Skill", description: "English intro", tags: ["design"] } },
		},
		updated_at: "",
	};

	it("把译文块的 name / description / tags 提到顶层（卡片与搜索读的就是顶层）", () => {
		const got = localizeMarketAbility(entry, "en");
		expect(got.name).toBe("Demo Skill");
		expect(got.description).toBe("English intro");
		expect(got.tags).toEqual(["design"]);
	});

	it("译文块缺某字段时该字段回落默认语言", () => {
		const partial: MarketAbility = { ...entry, detail: { ...entry.detail, i18n: { en: { name: "Demo Skill" } } } };
		const got = localizeMarketAbility(partial, "en");
		expect(got.name).toBe("Demo Skill");
		expect(got.description).toBe("中文简介");
		expect(got.tags).toEqual(["设计"]);
	});

	it("未命中语言时原样返回", () => {
		expect(localizeMarketAbility(entry, "ja")).toBe(entry);
	});
});
