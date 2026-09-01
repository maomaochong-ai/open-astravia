import type { AgentAbilitySelection } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import {
	abilityKeyForKind,
	isAgentAbilitySelected,
	selectAllAgentAbilities,
	toggleAgentAbility,
} from "./ability-selection";
import type { AgentCapabilityOption } from "./capability-options";

const base: AgentAbilitySelection = {
	selectionMode: "custom",
	skills: ["research"],
	mcpServers: [],
	plugins: [],
};
const mcp: AgentCapabilityOption = {
	id: "notion",
	kind: "mcp",
	title: "Notion",
	description: "",
	enabledGlobally: true,
};

describe("agent ability selection", () => {
	it("maps kinds to stable profile fields", () => {
		expect(abilityKeyForKind("skill")).toBe("skills");
		expect(abilityKeyForKind("mcp")).toBe("mcpServers");
		expect(abilityKeyForKind("plugin")).toBe("plugins");
	});

	it("toggles one capability without touching other kinds", () => {
		const next = toggleAgentAbility(base, mcp, [mcp]);
		expect(next).toEqual({
			selectionMode: "custom",
			skills: ["research"],
			mcpServers: ["notion"],
			plugins: [],
		});
		expect(isAgentAbilitySelected(next, mcp)).toBe(true);
		expect(toggleAgentAbility(next, mcp, [mcp])).toEqual(base);
	});

	it("uses every globally enabled capability and materializes the set when customized", () => {
		const disabled = { ...mcp, id: "disabled", enabledGlobally: false };
		const all = selectAllAgentAbilities([mcp, disabled]);

		expect(all).toEqual({
			selectionMode: "all",
			skills: [],
			mcpServers: ["notion"],
			plugins: [],
		});
		expect(isAgentAbilitySelected(all, mcp)).toBe(true);
		expect(isAgentAbilitySelected(all, disabled)).toBe(false);
		expect(toggleAgentAbility(all, mcp, [mcp, disabled])).toMatchObject({
			selectionMode: "custom",
			mcpServers: [],
		});
	});
});
