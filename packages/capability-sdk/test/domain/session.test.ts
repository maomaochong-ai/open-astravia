import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import { DOMAIN_SESSION_CAPABILITIES, DOMAIN_SESSION_CAPABILITY_CATALOG } from "../../src/domain.js";

describe("session domain capabilities", () => {
	it("uses stable ids for session history and runtime project queries", () => {
		expect(Object.values(DOMAIN_SESSION_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}session.list`,
			`${CAPABILITY_PREFIXES.ASTRAVIA_DOMAIN}session.runtime-project.list`,
		]);
	});

	it("validates session query inputs and outputs", () => {
		expect(DOMAIN_SESSION_CAPABILITIES.LIST.parseInput({ cwd: "C:/workspace", ignored: true })).toEqual({
			cwd: "C:/workspace",
		});
		expect(() => DOMAIN_SESSION_CAPABILITIES.LIST.parseInput({ cwd: "" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(() =>
			DOMAIN_SESSION_CAPABILITIES.LIST_RUNTIME_PROJECTS.parseOutput([{ cwd: "C:/workspace", sessionCount: -1 }]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() =>
			DOMAIN_SESSION_CAPABILITIES.LIST_RUNTIME_PROJECTS.parseOutput([{ cwd: "C:/workspace", sessionCount: 1.5 }]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() =>
			DOMAIN_SESSION_CAPABILITIES.LIST.parseOutput([
				{ id: "session", path: "C:/session.jsonl", cwd: "C:/workspace", firstMessage: "hello" },
			]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(
			DOMAIN_SESSION_CAPABILITIES.LIST.parseOutput([
				{
					id: "session",
					path: "C:/session.jsonl",
					cwd: "C:/workspace",
					firstMessage: "hello",
					modifiedAt: 1,
					parentEntryId: "parent",
					ignored: true,
				},
			]),
		).toEqual([
			{
				id: "session",
				path: "C:/session.jsonl",
				cwd: "C:/workspace",
				firstMessage: "hello",
				modifiedAt: 1,
				parentEntryId: "parent",
			},
		]);
		expect(() => DOMAIN_SESSION_CAPABILITIES.LIST_RUNTIME_PROJECTS.parseInput({ ignored: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
	});

	it("publishes session history and runtime project schemas", () => {
		expect(DOMAIN_SESSION_CAPABILITY_CATALOG).toHaveLength(2);
		expect(DOMAIN_SESSION_CAPABILITY_CATALOG[0]?.inputSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["cwd"],
			properties: {
				cwd: { type: "string", pattern: "\\S" },
			},
		});
		expect(DOMAIN_SESSION_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "path", "cwd", "firstMessage", "modifiedAt"],
			},
		});
		expect(DOMAIN_SESSION_CAPABILITY_CATALOG[1]?.outputSchema).toMatchObject({
			type: "array",
			items: {
				type: "object",
				properties: {
					sessionCount: { type: "integer", minimum: 0 },
				},
			},
		});
		expect(() => JSON.stringify(DOMAIN_SESSION_CAPABILITY_CATALOG)).not.toThrow();
	});
});
