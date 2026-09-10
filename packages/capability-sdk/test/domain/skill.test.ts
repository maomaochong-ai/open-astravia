import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_SKILL_CAPABILITIES,
	DOMAIN_SKILL_CAPABILITY_CATALOG,
	INSTALLED_SKILL_SOURCES,
	SKILL_TYPES,
} from "../../src/domain.js";

describe("skill domain capabilities", () => {
	it("uses one stable id per skill operation", () => {
		expect(Object.values(DOMAIN_SKILL_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}skill.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}skill.installed.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}skill.installed.set-enabled`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}skill.installed.uninstall`,
		]);
	});

	it("validates skill queries, installed records, and mutations", () => {
		expect(DOMAIN_SKILL_CAPABILITIES.LIST.parseInput({ cwd: "C:/workspace", ignored: true })).toEqual({
			cwd: "C:/workspace",
		});
		expect(() => DOMAIN_SKILL_CAPABILITIES.LIST.parseInput({ cwd: "   " })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(
			DOMAIN_SKILL_CAPABILITIES.LIST_INSTALLED.parseOutput({
				review: {
					name: "review",
					version: "1.0.0",
					installedAt: "2026-01-01T00:00:00.000Z",
					source: "market",
					enabled: true,
					type: SKILL_TYPES.SKILL,
					ignored: true,
				},
			}),
		).toEqual({
			review: {
				name: "review",
				version: "1.0.0",
				installedAt: "2026-01-01T00:00:00.000Z",
				source: INSTALLED_SKILL_SOURCES.MARKET,
				enabled: true,
				type: SKILL_TYPES.SKILL,
			},
		});
		expect(() =>
			DOMAIN_SKILL_CAPABILITIES.LIST_INSTALLED.parseOutput({
				review: {
					name: "review",
					version: "1.0.0",
					installedAt: "2026-01-01T00:00:00.000Z",
					source: "unknown",
					enabled: true,
				},
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() => DOMAIN_SKILL_CAPABILITIES.SET_ENABLED.parseInput({ name: "review", enabled: "yes" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_SKILL_CAPABILITIES.UNINSTALL.parseInput({ name: "review", type: "other" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_SKILL_CAPABILITIES.UNINSTALL.parseOutput(null)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }),
		);
	});

	it("accepts structured provenance while keeping legacy skill payloads compatible", () => {
		const parse = DOMAIN_SKILL_CAPABILITIES.LIST.parseOutput([
			{
				name: "native",
				description: "Native",
				source: "user",
				type: "skill",
				provenance: { kind: "native", scope: "user" },
			},
			{
				name: "plugin",
				description: "Plugin",
				source: "plugin",
				type: "skill",
				provenance: { kind: "provided", providerType: "plugin", providerId: "design" },
			},
			{
				name: "legacy",
				description: "Legacy",
				source: "agents-user",
				type: "skill",
			},
		]);
		expect(parse[0]?.provenance).toEqual({ kind: "native", scope: "user" });
		expect(parse[1]?.provenance).toEqual({ kind: "provided", providerType: "plugin", providerId: "design" });
		expect(parse[2]).not.toHaveProperty("provenance");
	});

	it("rejects malformed structured provenance", () => {
		expect(() =>
			DOMAIN_SKILL_CAPABILITIES.LIST.parseOutput([
				{
					name: "invalid",
					description: "Invalid",
					source: "plugin",
					type: "skill",
					provenance: { kind: "provided", providerType: "unknown", providerId: "x" },
				},
			]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("publishes skill enums and installed records in its catalog", () => {
		expect(DOMAIN_SKILL_CAPABILITY_CATALOG).toHaveLength(4);
		expect(DOMAIN_SKILL_CAPABILITY_CATALOG[0]?.inputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			properties: {
				cwd: { type: "string", pattern: "\\S" },
			},
		});
		expect(DOMAIN_SKILL_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "array",
			items: {
				type: "object",
				required: ["name", "description", "source", "type"],
				properties: {
					type: {
						anyOf: [
							{ const: SKILL_TYPES.SKILL, type: "string" },
							{ const: SKILL_TYPES.SCENE, type: "string" },
						],
					},
				},
			},
		});
		expect(DOMAIN_SKILL_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			items: { properties: { provenance: { anyOf: expect.any(Array) } } },
		});
		expect(DOMAIN_SKILL_CAPABILITY_CATALOG[1]?.outputSchema).toMatchObject({ type: "object" });
		expect(JSON.stringify(DOMAIN_SKILL_CAPABILITY_CATALOG[1]?.outputSchema)).toContain(
			`"const":"${INSTALLED_SKILL_SOURCES.MARKET}"`,
		);
		expect(DOMAIN_SKILL_CAPABILITY_CATALOG[3]?.outputSchema).toBe(false);
		expect(() => JSON.stringify(DOMAIN_SKILL_CAPABILITY_CATALOG)).not.toThrow();
	});
});
