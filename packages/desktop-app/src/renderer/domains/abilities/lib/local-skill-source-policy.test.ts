import { describe, expect, it } from "vitest";
import { isReadonlyLocalSkillSource } from "./local-skill-source-policy";

describe("isReadonlyLocalSkillSource", () => {
	it.each(["agents-user", "agents-project", "builtin", "scene"])("保留只读来源 %s", (source) => {
		expect(isReadonlyLocalSkillSource(source)).toBe(true);
	});

	it.each(["market", "custom", "plugin"])("不把受管或插件来源 %s 当成只读本地项", (source) => {
		expect(isReadonlyLocalSkillSource(source)).toBe(false);
	});
});
