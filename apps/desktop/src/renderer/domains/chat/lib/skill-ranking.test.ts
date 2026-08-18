import type { SkillInfo } from "@preload/api";
import { describe, expect, it } from "vitest";
import { filterSkills, lookupSkillUsage, sortSkillsForPanel } from "./skill-ranking";

function skill(name: string, source: string, type: SkillInfo["type"] = "skill"): SkillInfo {
	return { name, description: "", source, type };
}

describe("sortSkillsForPanel", () => {
	it("调用次数是最高优先级：用过的排在所有没用过的前面", () => {
		const skills = [skill("builtin-never", "builtin"), skill("generic-used", "agents-user")];
		const sorted = sortSkillsForPanel(skills, { "skill:generic-used": { used: 3, lastUsedAt: 100 } });
		expect(sorted.map((item) => item.name)).toEqual(["generic-used", "builtin-never"]);
	});

	it("次数相同再看类别：内置 > 插件 > Vetta 原生 > 通用", () => {
		const skills = [skill("d", "agents-project"), skill("c", "user"), skill("b", "plugin"), skill("a", "builtin")];
		expect(sortSkillsForPanel(skills, {}).map((item) => item.name)).toEqual(["a", "b", "c", "d"]);
	});

	it("次数与类别都相同时按最近使用、再按名称", () => {
		const skills = [skill("zebra", "builtin"), skill("apple", "builtin"), skill("recent", "builtin")];
		const sorted = sortSkillsForPanel(skills, {
			"skill:recent": { used: 0, lastUsedAt: 999 },
		});
		expect(sorted.map((item) => item.name)).toEqual(["recent", "apple", "zebra"]);
	});

	it("场景与 skill 同列排序，各自查自己的统计 key", () => {
		const skills = [skill("release", "scene", "scene"), skill("review", "builtin")];
		const sorted = sortSkillsForPanel(skills, { "scene:release": { used: 5, lastUsedAt: 10 } });
		expect(sorted.map((item) => item.name)).toEqual(["release", "review"]);
	});
});

describe("lookupSkillUsage", () => {
	it("统计 key 经小写归一，混合大小写的名字也能命中", () => {
		const usage = lookupSkillUsage(
			{ "skill:docx-export": { used: 7, lastUsedAt: 1 } },
			skill("DOCX-Export", "builtin"),
		);
		expect(usage.used).toBe(7);
	});

	it("查不到时返回零值而非 undefined", () => {
		expect(lookupSkillUsage({}, skill("missing", "builtin"))).toEqual({ used: 0, lastUsedAt: 0 });
	});
});

describe("filterSkills", () => {
	it("按名称与别名匹配，大小写无关", () => {
		const skills = [{ ...skill("upload", "builtin"), alias: "上传" }, skill("review", "builtin")];
		expect(filterSkills(skills, "UP").map((item) => item.name)).toEqual(["upload"]);
		expect(filterSkills(skills, "上传").map((item) => item.name)).toEqual(["upload"]);
		expect(filterSkills(skills, "")).toHaveLength(2);
	});
});
