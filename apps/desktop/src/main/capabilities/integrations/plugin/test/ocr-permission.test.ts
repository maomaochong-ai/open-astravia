import {
	CAPABILITY_ERROR_CODES,
	DOMAIN_OCR_CAPABILITIES,
	FOUNDATION_STORAGE_CAPABILITIES,
} from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITY_PERMISSIONS, PluginCapabilityAdapter } from "../index.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter OCR permission", () => {
	it("maps OCR use to the two consumer capabilities", async () => {
		const access = new RecordingAccessFactory();
		let permissions: readonly string[] = [PLUGIN_CAPABILITY_PERMISSIONS.OCR_RECOGNIZE];
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => permissions,
		});
		const sessionId = adapter.openSession("shimo-reader");
		expect(access.sessions[0]?.grants).toEqual([
			{ capabilityId: DOMAIN_OCR_CAPABILITIES.LIST_PROVIDERS.id },
			{ capabilityId: DOMAIN_OCR_CAPABILITIES.RECOGNIZE.id },
		]);
		await expect(adapter.listOcrProviders(sessionId)).resolves.toHaveLength(1);
		permissions = [];
		expect(() => adapter.listOcrProviders(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});

	it("qualifies plugin blobs and requires storage read separately", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [
				PLUGIN_CAPABILITY_PERMISSIONS.OCR_RECOGNIZE,
				PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ,
			],
		});
		const sessionId = adapter.openSession("shimo-reader");
		await adapter.recognizeOcr(sessionId, {
			inputs: [{ id: "page-1", mimeType: "image/png", source: { type: "plugin-blob", blobId: "page.png" } }],
		});
		expect(access.invocations.at(-1)).toMatchObject({
			capabilityId: DOMAIN_OCR_CAPABILITIES.RECOGNIZE.id,
			input: {
				ownerId: "shimo-reader",
				inputs: [{ source: { type: "storage-blob", namespace: "shimo-reader", id: "page.png" } }],
			},
		});
		expect(access.sessions[0]?.grants).toContainEqual({
			capabilityId: FOUNDATION_STORAGE_CAPABILITIES.READ_BLOB.id,
			constraints: [{ kind: "namespace", value: "shimo-reader" }],
		});
	});
});
