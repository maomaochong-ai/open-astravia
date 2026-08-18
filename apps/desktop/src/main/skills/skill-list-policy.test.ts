import { describe, expect, it } from "vitest";
import { shouldListSkill } from "./skill-list-policy";

describe("shouldListSkill", () => {
	it("列出直接放进 scene 目录但尚未登记清单的场景", () => {
		expect(shouldListSkill({ name: "local-scene", source: "scene" }, undefined)).toBe(true);
	});

	it("已登记场景仍由清单控制启停", () => {
		expect(shouldListSkill({ name: "review", source: "scene" }, { enabled: true })).toBe(true);
		expect(shouldListSkill({ name: "review", source: "scene" }, { enabled: false })).toBe(false);
	});

	it("未登记的市场安装项继续隐藏", () => {
		expect(shouldListSkill({ name: "market-skill", source: "market" }, undefined)).toBe(false);
	});
});
