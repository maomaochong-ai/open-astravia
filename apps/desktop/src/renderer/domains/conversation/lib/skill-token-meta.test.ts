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
		expect(map.get("skill:publish-ability")).toEqual({ label: "发布能力", icon: "solar:rocket-2-bold" });
	});

	it("没有别名 / 图标时回退成 slug + 默认图", () => {
		const map = buildSkillTokenMetaMap([{ ...publishAbility, alias: undefined }], new Map());
		expect(map.get("skill:publish-ability")).toEqual({ label: "publish-ability" });
	});

	it("内置 skill 的图标走 renderer 静态资源", () => {
		const map = buildSkillTokenMetaMap([{ ...publishAbility, source: "builtin" }], new Map());
		expect(map.get("skill:publish-ability")?.icon).toBe("./skills/publish-ability.png");
	});

	it("插件 skill 用列表自带的宿主插件 icon", () => {
		const icon = "vetta-plugin://vetta-ui-design/versions/0.1.0/icon.png?v=0.1.0";
		const map = buildSkillTokenMetaMap(
			[{ name: "vetta-ui-design", description: "", source: "plugin", type: "skill", icon }],
			new Map(),
		);
		expect(map.get("skill:vetta-ui-design")).toEqual({ label: "vetta-ui-design", icon });
	});

	it("市场目录优先于 skill.icon", () => {
		const map = buildSkillTokenMetaMap(
			[
				{
					name: "vetta-ui-design",
					description: "",
					source: "plugin",
					type: "skill",
					icon: "vetta-plugin://vetta-ui-design/icon.png",
				},
			],
			new Map([["skill:vetta-ui-design", "solar:layers-bold"]]),
		);
		expect(map.get("skill:vetta-ui-design")?.icon).toBe("solar:layers-bold");
	});

	it("scene 与同名 skill 分别解析，且场景继续使用自己的图标", () => {
		const scene = { ...publishAbility, type: "scene" as const, alias: "审查场景" };
		const map = buildSkillTokenMetaMap(
			[publishAbility, scene],
			new Map([
				["skill:publish-ability", "solar:rocket-2-bold"],
				["scene:publish-ability", "solar:clapperboard-open-bold"],
			]),
		);
		expect(map.get("skill:publish-ability")?.label).toBe("发布能力");
		expect(map.get("scene:publish-ability")).toEqual({
			label: "审查场景",
			icon: "solar:clapperboard-open-bold",
		});
	});
});
