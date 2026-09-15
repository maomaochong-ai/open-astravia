import type { AgentBlueprint } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { agentBlueprintLabel, resourceProviderName } from "./blueprint-display";

const blueprint = {
	id: "plugin:preset-agent:researcher",
	nameKey: "",
	descriptionKey: "",
	name: "%agent.researcher.name%",
	systemPrompt: "",
	defaultAbilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	source: { kind: "plugin", pluginId: "preset-agent" },
} satisfies AgentBlueprint;

const plugins = [
	{
		id: "preset-agent",
		name: "%plugin.name%",
		defaultLocale: "zh",
		locales: {
			zh: { "agent.researcher.name": "检索员", "plugin.name": "预设智能体" },
			en: { "agent.researcher.name": "Researcher", "plugin.name": "Preset Agents" },
		},
	},
];

describe("blueprint display", () => {
	it("resolves plugin text in the language the caller passes in", () => {
		expect(agentBlueprintLabel(blueprint, (key) => key, plugins, "en")).toBe("Researcher");
		expect(agentBlueprintLabel(blueprint, (key) => key, plugins, "zh")).toBe("检索员");
		expect(resourceProviderName(blueprint.source, plugins, "en")).toBe("Preset Agents");
	});
});
