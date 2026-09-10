import type { SkillInfo } from "@preload/api";
import { describe, expect, it } from "vitest";
import { prepareSkillsForSurface } from "./useSkillList";

describe("prepareSkillsForSurface", () => {
	it("filters each surface independently and applies product display text", () => {
		const skills: SkillInfo[] = [
			{ name: "native", description: "Native", source: "user", type: "skill" },
			{ name: "internal", description: "Internal", source: "plugin", type: "skill" },
			{
				name: "design",
				description: "Internal design",
				source: "plugin",
				type: "skill",
				presentation: {
					defaultVisibility: "hidden",
					surfaces: { skillPicker: "visible", commandPalette: "hidden" },
					displayName: "Vetta 设计",
				},
			},
		];

		expect(prepareSkillsForSurface(skills, "commandPalette").map((skill) => skill.name)).toEqual(["native"]);
		expect(prepareSkillsForSurface(skills, "skillPicker")).toEqual([
			expect.objectContaining({ name: "native", alias: "native" }),
			expect.objectContaining({ name: "design", alias: "Vetta 设计" }),
		]);
	});
});
