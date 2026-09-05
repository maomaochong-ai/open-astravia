import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../src/contracts.js";
import {
	FOUNDATION_BROWSER_CAPABILITIES,
	FOUNDATION_BROWSER_CAPABILITY_CATALOG,
	FOUNDATION_CAPABILITY_CATALOG,
	FOUNDATION_FILESYSTEM_CAPABILITIES,
	FOUNDATION_FILESYSTEM_CAPABILITY_CATALOG,
	FOUNDATION_GATEWAY_CAPABILITY_CATALOG,
	FOUNDATION_JOB_CAPABILITIES,
	FOUNDATION_NETWORK_CAPABILITIES,
	FOUNDATION_NETWORK_CAPABILITY_CATALOG,
	FOUNDATION_STORAGE_CAPABILITIES,
	FOUNDATION_STORAGE_CAPABILITY_CATALOG,
} from "../src/foundation.js";

describe("network and namespaced storage foundation capabilities", () => {
	it("uses one system-agnostic capability id per operation", () => {
		expect(FOUNDATION_NETWORK_CAPABILITIES.REQUEST.id).toBe(`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}network.request`);
		expect(
			[
				FOUNDATION_STORAGE_CAPABILITIES.LIST,
				FOUNDATION_STORAGE_CAPABILITIES.READ_FILE,
				FOUNDATION_STORAGE_CAPABILITIES.READ_SNAPSHOT,
				FOUNDATION_STORAGE_CAPABILITIES.COMMIT,
				FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB,
				FOUNDATION_STORAGE_CAPABILITIES.READ_BLOB,
				FOUNDATION_STORAGE_CAPABILITIES.GET_BLOB_REF,
			].map((capability) => capability.id),
		).toEqual([
			`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}storage.list`,
			`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}storage.read-file`,
			`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}storage.read-snapshot`,
			`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}storage.commit`,
			`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}storage.put-blob`,
			`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}storage.read-blob`,
			`${CAPABILITY_PREFIXES.VETTA_FOUNDATION}storage.get-blob-ref`,
		]);
	});

	it("validates namespaced file, snapshot, commit, and blob inputs", () => {
		expect(
			FOUNDATION_STORAGE_CAPABILITIES.READ_FILE.parseInput({
				namespace: "image-gen",
				path: "records/item.json",
				encoding: "utf8",
			}),
		).toEqual({ namespace: "image-gen", path: "records/item.json", encoding: "utf8" });
		expect(
			FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB.parseInput({
				namespace: "image-gen",
				blob: { id: "image", data: "ZGF0YQ==", mimeType: "image/png" },
			}),
		).toEqual({
			namespace: "image-gen",
			blob: { id: "image", data: "ZGF0YQ==", mimeType: "image/png" },
		});
		expect(() =>
			FOUNDATION_STORAGE_CAPABILITIES.READ_FILE.parseInput({
				namespace: "../escape",
				path: "image.png",
				encoding: "base64",
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			FOUNDATION_STORAGE_CAPABILITIES.COMMIT.parseInput({
				namespace: "image-gen",
				changes: [{ type: "write", path: "records/item.json", data: "", encoding: "utf8" }],
			}),
		).not.toThrow();
	});

	it("validates structured blob outputs", () => {
		expect(
			FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB.parseOutput({
				id: "image",
				url: "vetta-media://local/image",
				mimeType: "image/png",
			}),
		).toEqual({
			id: "image",
			url: "vetta-media://local/image",
			mimeType: "image/png",
		});
		expect(() =>
			FOUNDATION_STORAGE_CAPABILITIES.READ_BLOB.parseOutput({
				data: "ZGF0YQ==",
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_OUTPUT }));
	});

	it("publishes schemas for every foundation capability", () => {
		expect(FOUNDATION_BROWSER_CAPABILITY_CATALOG).toHaveLength(10);
		expect(FOUNDATION_FILESYSTEM_CAPABILITY_CATALOG).toHaveLength(10);
		expect(FOUNDATION_STORAGE_CAPABILITY_CATALOG).toHaveLength(12);
		expect(FOUNDATION_NETWORK_CAPABILITY_CATALOG).toHaveLength(1);
		expect(FOUNDATION_GATEWAY_CAPABILITY_CATALOG).toHaveLength(1);
		expect(FOUNDATION_CAPABILITY_CATALOG).toHaveLength(38);
		expect(() => JSON.stringify(FOUNDATION_CAPABILITY_CATALOG)).not.toThrow();
		expect(
			FOUNDATION_CAPABILITY_CATALOG.every(({ inputSchema, outputSchema }) => {
				return inputSchema !== undefined && outputSchema !== undefined;
			}),
		).toBe(true);
	});

	it("validates structured browser sessions and actions without exposing engine arguments", () => {
		expect(
			FOUNDATION_BROWSER_CAPABILITIES.SESSION_CREATE.parseInput({
				namespace: "plugin:publisher",
				profile: { type: "persistent", id: "social-accounts" },
				headed: true,
				allowedHosts: ["*.example.com"],
				engineArgs: ["--eval"],
			}),
		).toEqual({
			namespace: "plugin:publisher",
			profile: { type: "persistent", id: "social-accounts" },
			headed: true,
			allowedHosts: ["*.example.com"],
		});
		expect(
			FOUNDATION_BROWSER_CAPABILITIES.ACT.parseInput({
				namespace: "plugin:publisher",
				sessionId: "session-1",
				snapshotRevision: 3,
				action: { type: "fill", target: "@e2", value: "content" },
			}),
		).toMatchObject({ action: { type: "fill", target: "@e2", value: "content" } });
		expect(() =>
			FOUNDATION_BROWSER_CAPABILITIES.SESSION_GET.parseInput({
				namespace: "../other-plugin",
				sessionId: "session-1",
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(() =>
			FOUNDATION_BROWSER_CAPABILITIES.ACT.parseInput({
				namespace: "plugin:publisher",
				sessionId: "session-1",
				action: { type: "eval", value: "document.cookie" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
	});

	it("preserves dynamic JSON keys while cleaning contract object fields", () => {
		expect(
			FOUNDATION_NETWORK_CAPABILITIES.REQUEST.parseInput({
				namespace: "network-policy",
				request: { nested: { keep: true }, list: [1, null, "value"] },
				remove: true,
			}),
		).toEqual({
			namespace: "network-policy",
			request: { nested: { keep: true }, list: [1, null, "value"] },
		});
		expect(() =>
			FOUNDATION_NETWORK_CAPABILITIES.REQUEST.parseInput({
				pluginId: "plugin-id",
				request: { url: "https://example.com" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }));
		expect(
			FOUNDATION_FILESYSTEM_CAPABILITIES.READ_DIRECTORY.parseOutput([
				{
					name: "file.txt",
					path: "/file.txt",
					isDirectory: false,
					size: 1,
					modifiedAt: 2,
					remove: true,
				},
			]),
		).toEqual([
			{
				name: "file.txt",
				path: "/file.txt",
				isDirectory: false,
				size: 1,
				modifiedAt: 2,
			},
		]);
	});

	it("keeps open-object extension fields when additionalProperties is true", () => {
		expect(
			FOUNDATION_JOB_CAPABILITIES.GET.parseOutput({
				id: "job-1",
				domain: "media",
				operation: "generate",
				status: "succeeded",
				artifacts: [
					{
						id: "artifact-1",
						mimeType: "video/mp4",
						sizeBytes: 10,
						lifetime: "temporary",
						kind: "video",
						customExtension: "kept",
					},
				],
			}),
		).toMatchObject({
			artifacts: [{ kind: "video", customExtension: "kept" }],
		});
	});
});
