import { describe, expect, it } from "vitest";
import {
	AGENT_TEAM_PRESET_VERSION,
	BUILTIN_AGENT_PRESETS,
	createAgentTeamFixture,
	createEmptyAgentTeamDocument,
	DEFAULT_AGENT_TEAM_ID,
} from "../src/index.js";

describe("Agent Team presets", () => {
	it("creates a ready-to-use default team whose agents inherit all abilities", () => {
		const document = createAgentTeamFixture();

		expect(document.presetVersion).toBe(AGENT_TEAM_PRESET_VERSION);
		expect(document.teams.map((team) => team.id)).toContain(DEFAULT_AGENT_TEAM_ID);
		expect(document.agents).toHaveLength(BUILTIN_AGENT_PRESETS.length);
		expect(document.agents.every((agent) => agent.abilities.selectionMode === "all")).toBe(true);
	});

	it("keeps an empty document available for new file repositories", () => {
		expect(createEmptyAgentTeamDocument()).toEqual({
			schemaVersion: 1,
			revision: 0,
			agents: [],
			teams: [],
		});
	});
});
