import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import { DOMAIN_UPDATER_CAPABILITIES, DOMAIN_UPDATER_CAPABILITY_CATALOG, UPDATER_PHASES } from "../../src/domain.js";

describe("updater domain capabilities", () => {
	it("uses one stable id per updater operation", () => {
		expect(Object.values(DOMAIN_UPDATER_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}updater.state.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}updater.current-version.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}updater.check`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}updater.download`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}updater.install`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}updater.dismiss`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}updater.cancel`,
		]);
	});

	it("validates updater states at the contract boundary", () => {
		expect(
			DOMAIN_UPDATER_CAPABILITIES.GET_STATE.parseOutput({
				phase: UPDATER_PHASES.DOWNLOADING,
				currentVersion: "1.0.0",
				latestVersion: "1.1.0",
				progress: 0.5,
				downloadedBytes: 5,
				totalBytes: 10,
				ignored: true,
			}),
		).toEqual({
			phase: UPDATER_PHASES.DOWNLOADING,
			currentVersion: "1.0.0",
			latestVersion: "1.1.0",
			progress: 0.5,
			downloadedBytes: 5,
			totalBytes: 10,
		});
		expect(() =>
			DOMAIN_UPDATER_CAPABILITIES.GET_STATE.parseOutput({
				phase: UPDATER_PHASES.DOWNLOADING,
				currentVersion: "1.0.0",
				progress: 2,
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() =>
			DOMAIN_UPDATER_CAPABILITIES.GET_STATE.parseOutput({
				phase: UPDATER_PHASES.DOWNLOADING,
				currentVersion: "1.0.0",
				downloadedBytes: -1,
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() => DOMAIN_UPDATER_CAPABILITIES.CHECK.parseInput({ force: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_UPDATER_CAPABILITIES.INSTALL.parseOutput(null)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }),
		);
	});

	it("publishes updater constraints in its catalog", () => {
		expect(DOMAIN_UPDATER_CAPABILITY_CATALOG).toHaveLength(7);
		expect(DOMAIN_UPDATER_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["phase", "currentVersion"],
			properties: {
				progress: { type: "number", minimum: 0, maximum: 1 },
				downloadedBytes: { type: "number", minimum: 0 },
				totalBytes: { type: "number", minimum: 0 },
			},
		});
		expect(DOMAIN_UPDATER_CAPABILITY_CATALOG[1]?.outputSchema).toEqual({ type: "string" });
		expect(DOMAIN_UPDATER_CAPABILITY_CATALOG[4]?.outputSchema).toBe(false);
		expect(() => JSON.stringify(DOMAIN_UPDATER_CAPABILITY_CATALOG)).not.toThrow();
	});
});
