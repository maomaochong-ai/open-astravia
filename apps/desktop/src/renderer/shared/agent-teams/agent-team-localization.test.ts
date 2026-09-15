// @vitest-environment jsdom

import type { AgentProfile, AgentTeamDocument, TeamDefinition } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { localizeAgentTeamDocument } from "./agent-team-localization";

const catalogs = {
	"preset-agent": {
		defaultLocale: "zh",
		locales: {
			zh: { "agent.researcher.name": "检索员", "team.dev.name": "开发团队" },
			en: {
				"agent.researcher.name": "Researcher",
				"agent.researcher.description": "Gathers facts and verifies them.",
				"team.dev.name": "Dev Team",
			},
		},
	},
};

function agent(overrides: Partial<AgentProfile> = {}): AgentProfile {
	return {
		id: "researcher",
		revision: 1,
		name: "检索员",
		description: "收集事实并逐条核实。",
		mentionHandle: "researcher",
		blueprintId: "plugin:preset-agent:researcher",
		abilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		source: {
			kind: "plugin",
			pluginId: "preset-agent",
			nameKey: "agent.researcher.name",
			descriptionKey: "agent.researcher.description",
		},
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function team(overrides: Partial<TeamDefinition> = {}): TeamDefinition {
	return {
		id: "dev-team",
		revision: 1,
		name: "开发团队",
		description: "",
		leaderMemberId: "m1",
		members: [{ id: "m1", handle: "researcher", binding: { kind: "reference", agentProfileId: "researcher" } }],
		orchestrationPolicyId: "leader-delegates-v1",
		contextPolicyId: "public-results-v1",
		source: { kind: "plugin", pluginId: "preset-agent", nameKey: "team.dev.name" },
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

function document(agents: AgentProfile[], teams: TeamDefinition[] = []): AgentTeamDocument {
	return { schemaVersion: 1, revision: 1, agents, teams };
}

describe("localizeAgentTeamDocument", () => {
	it("follows the interface language for plugin-provided agents and teams", () => {
		const localized = localizeAgentTeamDocument(document([agent()], [team()]), "en", catalogs);

		expect(localized.agents[0]?.name).toBe("Researcher");
		expect(localized.agents[0]?.description).toBe("Gathers facts and verifies them.");
		expect(localized.teams[0]?.name).toBe("Dev Team");
	});

	it("keeps the stored default-locale literal when the catalog lacks an entry", () => {
		const localized = localizeAgentTeamDocument(
			document([agent({ source: { kind: "plugin", pluginId: "preset-agent", nameKey: "agent.missing.name" } })]),
			"en",
			catalogs,
		);

		expect(localized.agents[0]?.name).toBe("检索员");
	});

	it("returns the same document when nothing is localizable, so downstream memos stay stable", () => {
		const own = agent({ id: "mine", name: "我的助手", source: undefined });
		const unloaded = agent({ source: { kind: "plugin", pluginId: "not-loaded", nameKey: "agent.researcher.name" } });
		const input = document([own, unloaded]);

		expect(localizeAgentTeamDocument(input, "en", catalogs)).toBe(input);
	});
});
