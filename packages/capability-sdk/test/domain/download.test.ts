import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_DOWNLOAD_CAPABILITIES,
	DOMAIN_DOWNLOAD_CAPABILITY_CATALOG,
	DOWNLOAD_STATUSES,
} from "../../src/domain.js";

describe("download domain capabilities", () => {
	it("uses stable ids for listing and canceling downloads", () => {
		expect(Object.values(DOMAIN_DOWNLOAD_CAPABILITIES).map((capability) => capability.id)).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}download.list`,
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}download.cancel`,
		]);
	});

	it("validates download inputs and outputs", () => {
		expect(DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL.parseInput({ id: "download" })).toEqual({ id: "download" });
		expect(DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL.parseInput({ id: "download", ignored: true })).toEqual({
			id: "download",
		});
		expect(() => DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL.parseInput({ id: "" })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
		);
		expect(
			DOMAIN_DOWNLOAD_CAPABILITIES.LIST.parseOutput([
				{
					id: "download",
					url: "https://example.com/file",
					filename: "file",
					path: "C:/downloads/file",
					totalBytes: 10,
					receivedBytes: 5,
					status: DOWNLOAD_STATUSES.DOWNLOADING,
					createdAt: 1,
					error: undefined,
					ignored: true,
				},
			]),
		).toEqual([
			{
				id: "download",
				url: "https://example.com/file",
				filename: "file",
				path: "C:/downloads/file",
				totalBytes: 10,
				receivedBytes: 5,
				status: DOWNLOAD_STATUSES.DOWNLOADING,
				createdAt: 1,
			},
		]);
		expect(() =>
			DOMAIN_DOWNLOAD_CAPABILITIES.LIST.parseOutput([
				{
					id: "download",
					url: "https://example.com/file",
					filename: "file",
					path: "C:/downloads/file",
					totalBytes: 10,
					receivedBytes: 5,
					status: "unknown",
					createdAt: 1,
				},
			]),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
		expect(() => DOMAIN_DOWNLOAD_CAPABILITIES.LIST.parseOutput("not-an-array")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }),
		);
		expect(() => DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL.parseOutput(null)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }),
		);
	});

	it("publishes a serializable catalog from the token schemas", () => {
		expect(DOMAIN_DOWNLOAD_CAPABILITY_CATALOG).toEqual([
			{
				id: DOMAIN_DOWNLOAD_CAPABILITIES.LIST.id,
				inputSchema: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
				kind: "query",
				layer: "domain",
				outputSchema: expect.objectContaining({
					type: "array",
					items: expect.objectContaining({
						required: expect.arrayContaining(["id", "status", "createdAt"]),
						properties: expect.objectContaining({
							status: expect.objectContaining({ anyOf: expect.any(Array) }),
						}),
					}),
				}),
				version: 1,
			},
			{
				id: DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL.id,
				inputSchema: {
					type: "object",
					required: ["id"],
					properties: {
						id: { type: "string", pattern: "\\S" },
					},
				},
				kind: "command",
				layer: "domain",
				outputSchema: false,
				version: 1,
			},
		]);
		expect(JSON.parse(JSON.stringify(DOMAIN_DOWNLOAD_CAPABILITY_CATALOG))).toEqual(
			DOMAIN_DOWNLOAD_CAPABILITY_CATALOG,
		);
		expect(DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL.input.parse({ id: "download" })).toEqual({ id: "download" });
	});
});
