import { describe, expect, it } from "vitest";
import { shouldListSkill } from "./skill-list-policy";

describe("shouldListSkill", () => {
	it("本地来源未登记清单时直接列出，已登记则由清单控制启停", () => {
		expect(shouldListSkill({ name: "local", source: "user" }, undefined)).toBe(true);
		expect(shouldListSkill({ name: "review", source: "user" }, { enabled: false })).toBe(false);
	});

	it("未登记的市场安装项继续隐藏", () => {
		expect(shouldListSkill({ name: "market-skill", source: "market" }, undefined)).toBe(false);
	});
});
