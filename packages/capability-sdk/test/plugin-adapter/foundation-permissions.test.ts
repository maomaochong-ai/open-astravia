import { describe, expect, it } from "vitest";
import { CAPABILITY_CONSTRAINT_KINDS } from "../../src/access.js";
import { PLUGIN_CAPABILITY_PERMISSIONS, PluginCapabilityAdapter } from "../../src/adapters/plugin/index.js";
import { CAPABILITY_ERROR_CODES } from "../../src/contracts.js";
import {
	FOUNDATION_FILESYSTEM_CAPABILITIES,
	FOUNDATION_NETWORK_CAPABILITIES,
	FOUNDATION_STORAGE_CAPABILITIES,
} from "../../src/foundation.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter foundation permissions", () => {
	it("maps plugin permissions to exact filesystem capability grants", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ],
		});

		const sessionId = adapter.openSession("reader");
		const grantedIds = access.sessions[0]?.grants.map((grant) => grant.capabilityId);

		expect(grantedIds).toEqual([
			FOUNDATION_FILESYSTEM_CAPABILITIES.READ_DIRECTORY.id,
			FOUNDATION_FILESYSTEM_CAPABILITIES.READ_FILE.id,
			FOUNDATION_FILESYSTEM_CAPABILITIES.READ_BINARY_FILE.id,
			FOUNDATION_FILESYSTEM_CAPABILITIES.STAT.id,
			FOUNDATION_FILESYSTEM_CAPABILITIES.LIST_FILES_RECURSIVE.id,
		]);
		await expect(adapter.readFile(sessionId, "C:/project/file.txt")).resolves.toEqual({
			content: "data",
			encoding: "utf8",
		});
		expect(() => adapter.writeFile(sessionId, "C:/project/file.txt", "data")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});

	it("maps network and namespaced storage permissions to exact capability grants", async () => {
		const access = new RecordingAccessFactory();
		let permissions: readonly string[] = [
			PLUGIN_CAPABILITY_PERMISSIONS.NETWORK_FETCH,
			PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ,
			PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE,
		];
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => permissions,
		});

		const sessionId = adapter.openSession("storage-user");
		const namespaceConstraint = {
			kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE,
			value: "storage-user",
		};

		expect(access.sessions[0]?.grants).toEqual([
			{ capabilityId: FOUNDATION_NETWORK_CAPABILITIES.REQUEST.id },
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.READ_JSON.id,
				constraints: [namespaceConstraint],
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.LIST.id,
				constraints: [namespaceConstraint],
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.READ_FILE.id,
				constraints: [namespaceConstraint],
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.READ_BLOB.id,
				constraints: [namespaceConstraint],
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.GET_BLOB_REF.id,
				constraints: [namespaceConstraint],
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.WRITE_JSON.id,
				constraints: [namespaceConstraint],
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.WRITE_FILE.id,
				constraints: [namespaceConstraint],
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB.id,
				constraints: [namespaceConstraint],
			},
		]);

		await expect(adapter.requestNetwork(sessionId, { url: "https://example.com" })).resolves.toHaveProperty(
			"status",
			200,
		);
		await expect(adapter.readStorageJson(sessionId, "records/item.json")).resolves.toEqual({ ok: true });
		await expect(adapter.writeStorageJson(sessionId, "records/item.json", { ok: true })).resolves.toBeUndefined();
		await expect(
			adapter.putStorageBlob(sessionId, { id: "blob", data: "ZGF0YQ==", mimeType: "image/png" }),
		).resolves.toHaveProperty("id", "blob");

		expect(access.invocations).toEqual([
			{
				capabilityId: FOUNDATION_NETWORK_CAPABILITIES.REQUEST.id,
				input: { pluginId: "storage-user", request: { url: "https://example.com" } },
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.READ_JSON.id,
				input: { namespace: "storage-user", key: "records/item.json" },
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.WRITE_JSON.id,
				input: { namespace: "storage-user", key: "records/item.json", value: { ok: true } },
			},
			{
				capabilityId: FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB.id,
				input: {
					namespace: "storage-user",
					blob: { id: "blob", data: "ZGF0YQ==", mimeType: "image/png" },
				},
			},
		]);

		permissions = [];
		expect(() => adapter.readStorageJson(sessionId, "records/item.json")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});

	it("allows empty file content", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_WRITE],
		});
		const sessionId = adapter.openSession("writer");

		await expect(adapter.writeFile(sessionId, "C:/project/empty.txt", "")).resolves.toBeUndefined();
	});

	it("binds the network capability input to the session plugin", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.NETWORK_FETCH],
		});
		const sessionId = adapter.openSession("network-owner");

		await adapter.requestNetwork(sessionId, { url: "https://example.com" });

		expect(access.invocations).toEqual([
			{
				capabilityId: FOUNDATION_NETWORK_CAPABILITIES.REQUEST.id,
				input: { pluginId: "network-owner", request: { url: "https://example.com" } },
			},
		]);
	});
});
