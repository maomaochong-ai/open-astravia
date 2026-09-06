import type { AgentAbilitySelection } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import {
	abilityKeyForKind,
	isAgentAbilitySelected,
	normalizeAgentAbilitySelection,
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

	it("includes plugin-contributed skills when a plugin is enabled", () => {
		const plugin: AgentCapabilityOption = {
			id: "content-creation",
			kind: "plugin",
			title: "内容创作",
			description: "",
			enabledGlobally: true,
		};
		const skill: AgentCapabilityOption = {
			id: "create-content-campaign",
			kind: "skill",
			title: "Create campaign",
			description: "",
			enabledGlobally: true,
			sourcePluginId: "content-creation",
		};
		const next = toggleAgentAbility({ ...base, skills: [] }, plugin, [plugin, skill]);
		expect(next.plugins).toEqual(["content-creation"]);
		expect(next.skills).toEqual(["create-content-campaign"]);
		expect(toggleAgentAbility(next, plugin, [plugin, skill]).skills).toEqual([]);
	});

	it("includes the owning plugin when one of its skills is enabled", () => {
		const skill: AgentCapabilityOption = {
			id: "direct-image-creation",
			kind: "skill",
			title: "Direct image creation",
			description: "",
			enabledGlobally: true,
			sourcePluginId: "content-creation",
		};
		const next = toggleAgentAbility({ ...base, skills: [] }, skill, [skill]);
		expect(next.skills).toEqual(["direct-image-creation"]);
		expect(next.plugins).toEqual(["content-creation"]);
		expect(toggleAgentAbility(next, skill, [skill]).plugins).toEqual([]);
	});

	it("normalizes legacy plugin selections to include their contributed skills", () => {
		const skill: AgentCapabilityOption = {
			id: "develop-creative-concept",
			kind: "skill",
			title: "Develop concept",
			description: "",
			enabledGlobally: true,
			sourcePluginId: "content-creation",
		};
		expect(
			normalizeAgentAbilitySelection({ ...base, skills: [], plugins: ["content-creation"] }, [skill]),
		).toMatchObject({
			skills: ["develop-creative-concept"],
			plugins: ["content-creation"],
		});
	});

	it("preserves an explicit partial selection for a selected plugin", () => {
		const skills: AgentCapabilityOption[] = ["develop-creative-concept", "direct-image-creation"].map((id) => ({
			id,
			kind: "skill",
			title: id,
			description: "",
			enabledGlobally: true,
			sourcePluginId: "content-creation",
		}));
		expect(
			normalizeAgentAbilitySelection(
				{
					...base,
					skills: ["develop-creative-concept"],
					plugins: ["content-creation"],
				},
				skills,
			),
		).toMatchObject({
			skills: ["develop-creative-concept"],
			plugins: ["content-creation"],
		});
	});
});
