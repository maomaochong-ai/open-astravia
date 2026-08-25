import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import { DOMAIN_AGENT_SETTINGS_CAPABILITIES, DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG } from "../../src/domain.js";

describe("agent settings domain capabilities", () => {
	it("uses one stable id per agent settings operation", () => {
		expect(Object.values(DOMAIN_AGENT_SETTINGS_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}agent-settings.experimental.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}agent-settings.experimental.set`,
		]);
	});

	it("validates complete snapshots and non-empty partial updates", () => {
		expect(
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.GET_EXPERIMENTAL.parseOutput({
				vettaCli: true,
				promptPrediction: false,
				agentSkills: true,
				ignored: true,
			}),
		).toEqual({ vettaCli: true, promptPrediction: false, agentSkills: true });
		expect(DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL.parseInput({ promptPrediction: true })).toEqual({
			promptPrediction: true,
		});
		expect(() => DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL.parseInput({})).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() =>
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL.parseInput({ promptPrediction: "yes" }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL.parseInput({
				promptPrediction: true,
				unsupported: false,
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("publishes schemas for agent settings discovery", () => {
		expect(DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG).toHaveLength(2);
		expect(DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG[0]?.inputSchema).toEqual({
			type: "object",
			properties: {},
			additionalProperties: false,
		});
		expect(DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["vettaCli", "promptPrediction", "agentSkills"],
		});
		expect(DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG[1]?.inputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			minProperties: 1,
		});
		expect(() => JSON.stringify(DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG)).not.toThrow();
	});
});
