import { describe, expect, it } from "vitest";
import type { ListedSkill } from "../skills/skill-service.js";
import { toRemoteSkillOptions } from "./remote-skills.js";

function skill(name: string, extra: Partial<ListedSkill> = {}): ListedSkill {
	return { name, description: `${name} description`, source: "user", type: "skill", ...extra };
}

describe("toRemoteSkillOptions", () => {
	it("keeps what the composer picker shows, in the same usage-first order", () => {
		const options = toRemoteSkillOptions(
			[
				skill("zeta"),
				skill("builtin-one", { source: "builtin" }),
				skill("hidden-plugin", { source: "plugin" }),
				skill("shown-plugin", {
					source: "plugin",
					presentation: { surfaces: { skillPicker: "visible" } },
				}),
				skill("weekly", { type: "scene", source: "scene" }),
			],
			{ "skill:zeta": { used: 2, lastUsedAt: 10 } },
		);
		expect(options.map((option) => option.name)).toEqual(["zeta", "builtin-one", "shown-plugin", "weekly"]);
		expect(options.at(-1)).toEqual({
			name: "weekly",
			description: "weekly description",
			type: "scene",
			source: "scene",
		});
	});

	it("sends the display name as alias only when it differs, and trims long descriptions", () => {
		const options = toRemoteSkillOptions(
			[
				skill("frontend-design", { alias: "前端设计", description: "x".repeat(1000) }),
				skill("pdf", { alias: "pdf" }),
			],
			{},
		);
		const aliased = options.find((option) => option.name === "frontend-design");
		const plain = options.find((option) => option.name === "pdf");
		expect(aliased?.alias).toBe("前端设计");
		expect(aliased?.description.length).toBe(400);
		expect(aliased?.description.endsWith("…")).toBe(true);
		expect(plain).not.toHaveProperty("alias");
		expect(JSON.stringify([aliased, plain])).not.toMatch(/icon|provenance|presentation/);
	});
});
