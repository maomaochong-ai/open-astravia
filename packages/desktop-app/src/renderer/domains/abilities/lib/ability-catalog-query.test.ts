import { describe, expect, it } from "vitest";
import type { SkillAbility } from "../types";
import { queryAbilityCatalog } from "./ability-catalog-query";

function ability(index: number, overrides: Partial<SkillAbility> = {}): SkillAbility {
	const slug = `ability-${String(index).padStart(3, "0")}`;
	return {
		id: `skill:${slug}`,
		slug,
		type: "skill",
		catalogSource: { kind: "server", id: "server" },
		title: `Ability ${String(index).padStart(3, "0")}`,
		description: "",
		category: "General",
		tags: [],
		author: "",
		license: "MIT",
		version: "1.0.0",
		installed: false,
		enabled: false,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [slug, `keyword-${index}`],
		...overrides,
	};
}

describe("queryAbilityCatalog", () => {
	it("paginates the in-memory catalog without changing the source", () => {
		const items = Array.from({ length: 125 }, (_, index) => ability(index));

		const page = queryAbilityCatalog(items, { scope: "discover", page: 2, pageSize: 60 });

		expect(page).toMatchObject({ total: 125, page: 2, pageSize: 60, pageCount: 3 });
		expect(page.items).toHaveLength(60);
		expect(page.items[0]?.slug).toBe("ability-060");
	});

	it("filters locally by keyword, category, type and source", () => {
		const github = ability(1, {
			category: "Design",
			catalogSource: {
				kind: "github",
				id: "community",
				name: "Community",
				repository: "https://github.com/example/community",
			},
			origin: {
				kind: "github-marketplace",
				sourceId: "community",
				marketplace: "community",
				marketplaceVersion: "1.0.0",
				repository: "https://github.com/example/community",
			},
		});
		const server = ability(2, { category: "Design" });

		const page = queryAbilityCatalog([server, github], {
			scope: "discover",
			keyword: "keyword-1",
			category: "Design",
			types: ["skill"],
			sourceIds: ["community"],
			page: 1,
			pageSize: 60,
		});

		expect(page.items.map((item) => item.id)).toEqual([github.id]);
	});

	it("sorts deterministically and limits mine to installed abilities", () => {
		const second = ability(2, { installed: true, title: "Same" });
		const first = ability(1, { installed: true, title: "Same" });

		const page = queryAbilityCatalog([second, ability(3), first], {
			scope: "mine",
			page: 1,
			pageSize: 60,
		});

		expect(page.items.map((item) => item.id)).toEqual([first.id, second.id]);
	});

	it("keeps discover ordering stable when installation state changes", () => {
		const popular = ability(1, { downloadCount: 100 });
		const other = ability(2, { downloadCount: 10, installed: true, needsUpdate: true, setupRequired: true });

		const before = queryAbilityCatalog([other, popular], { scope: "discover", page: 1, pageSize: 60 });
		const after = queryAbilityCatalog(
			[
				{ ...other, installed: false, needsUpdate: false, setupRequired: false },
				{ ...popular, installed: true },
			],
			{ scope: "discover", page: 1, pageSize: 60 },
		);

		expect(before.items.map((item) => item.id)).toEqual([popular.id, other.id]);
		expect(after.items.map((item) => item.id)).toEqual([popular.id, other.id]);
	});
});
