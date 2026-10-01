import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_GENERAL_SETTINGS_CAPABILITIES,
	DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG,
	GENERAL_EXECUTION_MODES,
	SANDBOX_BACKENDS,
	SANDBOX_STATUSES,
} from "../../src/domain.js";

describe("general settings domain capabilities", () => {
	it("uses one stable id per general settings operation", () => {
		expect(Object.values(DOMAIN_GENERAL_SETTINGS_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}general-settings.get`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}general-settings.notifications.set`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}general-settings.default-execution-mode.set`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}general-settings.workspace.set`,
		]);
	});

	it("validates settings snapshots and mutations", () => {
		expect(
			DOMAIN_GENERAL_SETTINGS_CAPABILITIES.GET.parseOutput({
				workspacePath: "C:/workspace",
				defaultExecutionMode: GENERAL_EXECUTION_MODES.FULL_ACCESS,
				notificationsEnabled: true,
				debugMode: false,
				sandbox: {
					status: SANDBOX_STATUSES.AVAILABLE,
					backend: SANDBOX_BACKENDS.WINDOWS_HOST,
					platform: "win32",
					features: {
						readRoots: true,
						writeRoots: true,
						denyRead: true,
						denyWrite: true,
						tempRootIsolation: true,
						networkIsolation: false,
						processTreeKill: true,
						passiveProbe: true,
						activeProbe: false,
						ignored: true,
					},
					ignored: true,
				},
				ignored: true,
			}),
		).not.toHaveProperty("sandbox.ignored");
		expect(
			DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_DEFAULT_EXECUTION_MODE.parseInput({
				mode: GENERAL_EXECUTION_MODES.SANDBOX,
				ignored: true,
			}),
		).toEqual({ mode: GENERAL_EXECUTION_MODES.SANDBOX });
		expect(() =>
			DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_DEFAULT_EXECUTION_MODE.parseInput({ mode: "inherit" }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() => DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_WORKSPACE.parseInput({ path: "   " })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_WORKSPACE.parseOutput({ path: "" })).toEqual({ path: "" });
		expect(() =>
			DOMAIN_GENERAL_SETTINGS_CAPABILITIES.GET.parseOutput({
				workspacePath: "C:/workspace",
				defaultExecutionMode: "full-access",
				notificationsEnabled: true,
				debugMode: false,
				sandbox: { status: "ready", backend: null, platform: "win32" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("publishes nested sandbox and mutation schemas", () => {
		expect(DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG).toHaveLength(4);
		expect(DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "object",
			required: ["workspacePath", "defaultExecutionMode", "notificationsEnabled", "debugMode", "sandbox"],
			properties: {
				sandbox: {
					type: "object",
					required: ["status", "backend", "platform"],
					properties: {
						features: {
							type: "object",
							required: [
								"readRoots",
								"writeRoots",
								"denyRead",
								"denyWrite",
								"tempRootIsolation",
								"networkIsolation",
								"processTreeKill",
								"passiveProbe",
								"activeProbe",
							],
						},
					},
				},
			},
		});
		expect(JSON.stringify(DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG[0]?.outputSchema)).toContain(
			`"const":"${SANDBOX_BACKENDS.WINDOWS_HOST}"`,
		);
		expect(DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG[3]?.inputSchema).toMatchObject({
			properties: { path: { type: "string", pattern: "\\S" } },
		});
		expect(DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG[3]?.outputSchema).toMatchObject({
			properties: { path: { type: "string" } },
		});
		expect(() => JSON.stringify(DOMAIN_GENERAL_SETTINGS_CAPABILITY_CATALOG)).not.toThrow();
	});
});
