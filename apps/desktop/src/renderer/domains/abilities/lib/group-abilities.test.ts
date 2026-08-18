import { describe, expect, it } from "vitest";
import {
	ABILITY_CATEGORY_CONNECTORS,
	ABILITY_CATEGORY_UNCATEGORIZED,
	ABILITY_CATEGORY_VETTA_BUILTIN,
	type SkillAbility,
} from "../types";
import { groupAbilities } from "./group-abilities";

function ability(slug: string, overrides: Partial<SkillAbility> = {}): SkillAbility {
	return {
		id: `skill:${slug}`,
		slug,
		type: "skill",
		catalogSource: { kind: "server", id: "server" },
		title: slug,
		description: "",
		category: "General",
		tags: [],
		author: "",
		license: "",
		version: "1.0.0",
		installed: true,
		enabled: true,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [slug],
		...overrides,
	};
}

describe("groupAbilities", () => {
	it("puts builtin abilities in their own group between categorized and uncategorized ones", () => {
		const groups = groupAbilities([
			ability("local-skill", { category: "", catalogSource: { kind: "local", id: "local" }, fromMarket: false }),
			ability("builtin-skill", {
				category: "",
				catalogSource: { kind: "builtin", id: "builtin" },
				isBuiltin: true,
				readonly: true,
				fromMarket: false,
			}),
			ability("market-skill", { category: "General" }),
			ability("notion", { category: ABILITY_CATEGORY_CONNECTORS }),
		]);

		expect(groups.map((group) => group.category)).toEqual([
			ABILITY_CATEGORY_CONNECTORS,
			"General",
			ABILITY_CATEGORY_VETTA_BUILTIN,
			ABILITY_CATEGORY_UNCATEGORIZED,
		]);
		expect(groups[2]?.items.map((item) => item.slug)).toEqual(["builtin-skill"]);
		expect(groups[3]?.items.map((item) => item.slug)).toEqual(["local-skill"]);
	});

	it("keeps builtin abilities out of their market category", () => {
		const groups = groupAbilities([
			ability("system-plugin", {
				category: "Design",
				catalogSource: { kind: "builtin", id: "builtin" },
				isBuiltin: true,
				readonly: true,
			}),
			ability("market-skill", { category: "Design" }),
		]);

		expect(groups.map((group) => group.category)).toEqual(["Design", ABILITY_CATEGORY_VETTA_BUILTIN]);
		expect(groups[0]?.items.map((item) => item.slug)).toEqual(["market-skill"]);
	});

	it("drops empty synthetic groups", () => {
		const groups = groupAbilities([ability("market-skill")]);

		expect(groups.map((group) => group.category)).toEqual(["General"]);
	});
});
