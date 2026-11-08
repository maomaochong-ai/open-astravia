import { describe, expect, it } from "vitest";
import {
	isBatchSkillList,
	MAX_PROJECT_SKILLS,
	normalizeBatchSkills,
	resolveProjectSkills,
} from "./batch-project-skills.js";

const skill = (name: string, alias?: string) => ({ name, type: "skill" as const, ...(alias ? { alias } : {}) });

describe("batch project skills", () => {
	it("merges the legacy single skill into the list instead of dropping it", () => {
		// 旧插件 schema 仍只发 `skill`：并成一项，否则这次写入等于「没挂技能」。
		expect(resolveProjectSkills({ skill: skill("review") })).toEqual([skill("review")]);
		expect(resolveProjectSkills({ skills: [skill("audit")] })).toEqual([skill("audit")]);
		// 两者都在时以 `skills` 为准，单个旧字段不追加出第二个技能。
		expect(resolveProjectSkills({ skill: skill("review"), skills: [skill("audit")] })).toEqual([skill("audit")]);
		// 都没提到时返回 undefined，让调用方区分「没提到」与「清空」。
		expect(resolveProjectSkills({})).toBeUndefined();
		expect(resolveProjectSkills({ skills: [] })).toBeUndefined();
	});

	it("trims and de-duplicates while keeping selection order", () => {
		expect(normalizeBatchSkills([skill("  review  ", " rv "), skill("audit"), skill("review")])).toEqual([
			skill("review", "rv"),
			skill("audit"),
		]);
	});

	it("rejects oversized, malformed, and duplicate-name lists", () => {
		expect(isBatchSkillList([skill("a"), skill("b")])).toBe(true);
		expect(isBatchSkillList(Array.from({ length: MAX_PROJECT_SKILLS + 1 }, (_, index) => skill(`s${index}`)))).toBe(
			false,
		);
		expect(isBatchSkillList([skill("a"), skill(" a ")])).toBe(false);
		expect(isBatchSkillList([{ name: "a", type: "other" }])).toBe(false);
		expect(isBatchSkillList("review")).toBe(false);
	});
});
