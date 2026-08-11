import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_KNOWLEDGE_CAPABILITIES,
	DOMAIN_KNOWLEDGE_CAPABILITY_CATALOG,
	KNOWLEDGE_NODE_TYPES,
	KNOWLEDGE_PROCESS_STATUSES,
	KNOWLEDGE_SCAN_REASONS,
} from "../../src/domain.js";

describe("knowledge domain capabilities", () => {
	it("uses one stable id per knowledge operation", () => {
		expect(Object.values(DOMAIN_KNOWLEDGE_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.base.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.file-status.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.processing.status.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.processing.settings.get`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.base.create`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.base.rename`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.base.delete`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.entry.add-files`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.entry.delete`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.processing.scan`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.processing.retry-failed`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}knowledge.processing.settings.set`,
		]);
	});

	it("validates knowledge mutations and preserves explicit model clearing", () => {
		expect(DOMAIN_KNOWLEDGE_CAPABILITIES.SCAN_NOW.parseInput({})).toEqual({});
		expect(() => DOMAIN_KNOWLEDGE_CAPABILITIES.SCAN_NOW.parseInput({ ignored: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		const update = DOMAIN_KNOWLEDGE_CAPABILITIES.SET_PROCESSING_SETTINGS.parseInput({
			data: {
				processingModelKey: null,
				processingModelReasoningLevel: null,
				agentConcurrency: 4,
			},
			ignored: true,
		});
		expect(update.data).toEqual({
			processingModelKey: null,
			processingModelReasoningLevel: null,
			agentConcurrency: 4,
		});
		expect(() =>
			DOMAIN_KNOWLEDGE_CAPABILITIES.ADD_FILES.parseInput({ kbId: "default_kb", paths: [], move: false }),
		).not.toThrow();
		expect(() =>
			DOMAIN_KNOWLEDGE_CAPABILITIES.SET_PROCESSING_SETTINGS.parseInput({ data: { agentConcurrency: 0 } }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			DOMAIN_KNOWLEDGE_CAPABILITIES.SET_PROCESSING_SETTINGS.parseInput({
				data: { enabled: true, ignored: true },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("cleans recursive bases and dynamic file statuses", () => {
		expect(
			DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_BASES.parseOutput([
				{
					id: "default_kb",
					name: "Default",
					updatedAt: 1,
					isDefault: true,
					nodes: [
						{
							id: "docs",
							name: "Docs",
							type: KNOWLEDGE_NODE_TYPES.DIRECTORY,
							children: [
								{
									id: "readme",
									name: "README.md",
									type: KNOWLEDGE_NODE_TYPES.FILE,
									size: 10,
									ignored: true,
								},
							],
							ignored: true,
						},
					],
					ignored: true,
				},
			]),
		).toEqual([
			{
				id: "default_kb",
				name: "Default",
				updatedAt: 1,
				isDefault: true,
				nodes: [
					{
						id: "docs",
						name: "Docs",
						type: KNOWLEDGE_NODE_TYPES.DIRECTORY,
						children: [
							{
								id: "readme",
								name: "README.md",
								type: KNOWLEDGE_NODE_TYPES.FILE,
								size: 10,
							},
						],
					},
				],
			},
		]);
		expect(
			DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_FILE_STATUSES.parseOutput({
				"README.md": { status: KNOWLEDGE_PROCESS_STATUSES.PROCESSED, wikiPath: "README.md", ignored: true },
			}),
		).toEqual({
			"README.md": { status: KNOWLEDGE_PROCESS_STATUSES.PROCESSED, wikiPath: "README.md" },
		});
		expect(() =>
			DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_BASES.parseOutput([
				{
					id: "default_kb",
					name: "Default",
					updatedAt: 1,
					isDefault: true,
					nodes: [{ id: "bad", name: "Bad", type: KNOWLEDGE_NODE_TYPES.FILE, size: -1 }],
				},
			]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("publishes recursive knowledge and processing schemas", () => {
		expect(DOMAIN_KNOWLEDGE_CAPABILITY_CATALOG).toHaveLength(12);
		expect(DOMAIN_KNOWLEDGE_CAPABILITY_CATALOG[0]?.outputSchema).toMatchObject({
			type: "array",
			items: {
				type: "object",
				required: ["id", "name", "updatedAt", "isDefault", "nodes"],
				properties: {
					nodes: {
						type: "array",
						items: {
							type: "object",
							required: ["id", "name", "type"],
							properties: {
								children: { type: "array", items: { $ref: "T0" } },
								childCount: { type: "number", minimum: 0 },
								size: { type: "number", minimum: 0 },
							},
						},
					},
				},
			},
		});
		expect(DOMAIN_KNOWLEDGE_CAPABILITY_CATALOG[11]?.inputSchema).toMatchObject({
			type: "object",
			required: ["data"],
			properties: {
				data: {
					type: "object",
					additionalProperties: false,
					minProperties: 1,
					properties: {
						pollIntervalMinutes: {
							anyOf: [{ const: 0 }, { const: 3 }, { const: 5 }, { const: 10 }, { const: 30 }],
						},
						processingModelKey: {
							anyOf: [{ type: "string" }, { type: "null" }],
						},
						agentConcurrency: { type: "integer", minimum: 1 },
					},
				},
			},
		});
		expect(
			DOMAIN_KNOWLEDGE_CAPABILITIES.SCAN_NOW.parseOutput({
				skipped: true,
				reason: KNOWLEDGE_SCAN_REASONS.NO_MODEL,
				ignored: true,
			}),
		).toEqual({ skipped: true, reason: KNOWLEDGE_SCAN_REASONS.NO_MODEL });
		expect(() => JSON.stringify(DOMAIN_KNOWLEDGE_CAPABILITY_CATALOG)).not.toThrow();
	});
});
