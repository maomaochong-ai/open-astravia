import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import { DOMAIN_PROJECT_CAPABILITIES, DOMAIN_PROJECT_CAPABILITY_CATALOG } from "../../src/domain.js";

describe("project domain capabilities", () => {
	it("uses one stable capability id per project operation", () => {
		expect(Object.values(DOMAIN_PROJECT_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}project.list`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}project.create`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}project.open`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}project.rename`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}project.archive`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}project.unarchive`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}project.remove`,
		]);
	});

	it("validates project inputs and outputs at the contract boundary", () => {
		expect(() => DOMAIN_PROJECT_CAPABILITIES.CREATE.parseInput({ name: "../escape" })).not.toThrow();
		expect(DOMAIN_PROJECT_CAPABILITIES.CREATE.parseInput({ name: "demo", ignored: true })).toEqual({
			name: "demo",
		});
		expect(() => DOMAIN_PROJECT_CAPABILITIES.CREATE.parseInput({ name: "" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_PROJECT_CAPABILITIES.OPEN.parseInput({ path: "   " })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() => DOMAIN_PROJECT_CAPABILITIES.LIST.parseOutput({ workspacePath: "C:/workspace" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }),
		);
		expect(
			DOMAIN_PROJECT_CAPABILITIES.LIST.parseOutput({
				workspacePath: "C:/workspace",
				projects: [{ path: "C:/workspace/demo", name: "demo", ignored: true }],
				archivedProjects: [],
				ignored: true,
			}),
		).toEqual({
			workspacePath: "C:/workspace",
			projects: [{ path: "C:/workspace/demo", name: "demo" }],
			archivedProjects: [],
		});
		expect(() => DOMAIN_PROJECT_CAPABILITIES.ARCHIVE.parseOutput(null)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }),
		);
	});

	it("publishes nested project schemas in its catalog", () => {
		expect(DOMAIN_PROJECT_CAPABILITY_CATALOG).toHaveLength(7);
		expect(DOMAIN_PROJECT_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["workspacePath", "projects", "archivedProjects"],
			properties: {
				projects: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["path"],
					},
				},
			},
		});
		expect(DOMAIN_PROJECT_CAPABILITY_CATALOG[1]?.inputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["name"],
			properties: {
				name: { type: "string", pattern: "\\S" },
			},
		});
		expect(DOMAIN_PROJECT_CAPABILITY_CATALOG[4]?.outputSchema).toBe(false);
		expect(() => JSON.stringify(DOMAIN_PROJECT_CAPABILITY_CATALOG)).not.toThrow();
	});
});
