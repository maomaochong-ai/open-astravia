import { describe, expect, it } from "vitest";
import type { AbilityItem, SkillAbility } from "../types";
import { decorateAbilityConflicts } from "./decorate-ability-conflicts";

function marketSkill(slug: string, overrides?: Partial<SkillAbility>): SkillAbility {
	return {
		type: "skill",
		id: `server:server:skill:${slug}`,
		slug,
		catalogSource: { kind: "server", id: "server" },
		title: slug,
		description: "",
		category: "",
		tags: [],
		author: "",
		license: "",
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
		searchTerms: [],
		...overrides,
	};
}

/** 通用 Agent Skill 目录（~/.agents/skills）发现出来的只读条目。 */
function genericAgentSkill(slug: string): SkillAbility {
	return {
		...marketSkill(slug),
		id: `builtin:builtin:skill:${slug}`,
		catalogSource: { kind: "builtin", id: "builtin" },
		installed: true,
		enabled: true,
		readonly: true,
		isBuiltin: true,
		fromMarket: false,
		skillSource: "agents-user",
	};
}

function findItem(items: AbilityItem[], id: string): AbilityItem {
	const found = items.find((item) => item.id === id);
	if (!found) throw new Error(`missing item ${id}`);
	return found;
}

describe("decorateAbilityConflicts", () => {
	it("通用 Agent 目录的同名 skill 不阻塞市场安装", () => {
		const items = decorateAbilityConflicts([marketSkill("xlsx"), genericAgentSkill("xlsx")]);
		expect(findItem(items, "server:server:skill:xlsx").installConflictIds).toBeUndefined();
	});

	it("受控来源已占位时仍然判冲突", () => {
		const items = decorateAbilityConflicts([
			marketSkill("xlsx"),
			{
				...marketSkill("xlsx"),
				id: "github:acme:skill:xlsx",
				catalogSource: { kind: "github", id: "acme", name: "acme", repository: "acme/skills" },
				installed: true,
				enabled: true,
			},
		]);
		expect(findItem(items, "server:server:skill:xlsx").installConflictIds).toEqual(["github:acme:skill:xlsx"]);
	});
});
