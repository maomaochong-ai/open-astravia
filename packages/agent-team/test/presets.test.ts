import { describe, expect, it } from "vitest";
import {
	AGENT_TEAM_PRESET_VERSION,
	BUILTIN_AGENT_PRESETS,
	createEmptyAgentTeamDocument,
	createInitialAgentTeamDocument,
	DEFAULT_AGENT_TEAM_ID,
	normalizeAgentTeamDocument,
} from "../src/index.js";

describe("Agent Team presets", () => {
	it("creates a ready-to-use default team whose agents inherit all abilities", () => {
		const document = createInitialAgentTeamDocument();

		expect(document.presetVersion).toBe(AGENT_TEAM_PRESET_VERSION);
		expect(document.teams.map((team) => team.id)).toContain(DEFAULT_AGENT_TEAM_ID);
		expect(document.agents).toHaveLength(BUILTIN_AGENT_PRESETS.length);
		expect(document.agents.every((agent) => agent.abilities.selectionMode === "all")).toBe(true);
	});

	it("seeds legacy documents once and keeps the normalized result idempotent", () => {
		const seeded = normalizeAgentTeamDocument(createEmptyAgentTeamDocument());
		const normalizedAgain = normalizeAgentTeamDocument(structuredClone(seeded));

		expect(seeded.revision).toBe(1);
		expect(normalizedAgain).toEqual(seeded);
	});
});
