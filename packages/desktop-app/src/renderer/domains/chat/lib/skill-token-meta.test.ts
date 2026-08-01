import type { SkillInfo } from "@preload/api";
import { describe, expect, it } from "vitest";
import { buildSkillTokenMetaMap } from "./skill-token-meta";

const publishAbility: SkillInfo = {
	name: "publish-ability",
	alias: "发布能力",
	description: "",
	source: "market",
	type: "skill",
};

describe("buildSkillTokenMetaMap", () => {
	it("把 slug 解析成命令区那份别名与图标", () => {
		const map = buildSkillTokenMetaMap([publishAbility], new Map([["skill:publish-ability", "solar:rocket-2-bold"]]));
		expect(map.get("publish-ability")).toEqual({ label: "发布能力", icon: "solar:rocket-2-bold" });
	});

	it("没有别名 / 图标时回退成 slug + 默认图", () => {
		const map = buildSkillTokenMetaMap([{ ...publishAbility, alias: undefined }], new Map());
		expect(map.get("publish-ability")).toEqual({ label: "publish-ability" });
	});

	it("内置 skill 的图标走 renderer 静态资源", () => {
		const map = buildSkillTokenMetaMap([{ ...publishAbility, source: "builtin" }], new Map());
		expect(map.get("publish-ability")?.icon).toBe("./skills/publish-ability.png");
	});

	it("scene 不进文本流 token 表：它走 promptRef 硬展开", () => {
		const map = buildSkillTokenMetaMap([{ ...publishAbility, type: "scene" }], new Map());
		expect(map.has("publish-ability")).toBe(false);
	});
});
