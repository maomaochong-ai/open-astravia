import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITY_PERMISSIONS, PluginCapabilityAdapter } from "../../src/adapters/plugin/index.js";
import { CAPABILITY_ERROR_CODES } from "../../src/contracts.js";
import { DOMAIN_MEDIA_CAPABILITIES } from "../../src/domain.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter media permission", () => {
	it("maps media.generate to exact domain capability grants", async () => {
		const access = new RecordingAccessFactory();
		let permissions: readonly string[] = [PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE];
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => permissions,
		});
		const sessionId = adapter.openSession("media-consumer");

		expect(access.sessions[0]?.grants).toEqual([
			{ capabilityId: DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS.id },
			{ capabilityId: DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.id },
			{ capabilityId: DOMAIN_MEDIA_CAPABILITIES.GET_JOB.id },
			{ capabilityId: DOMAIN_MEDIA_CAPABILITIES.CANCEL_JOB.id },
			{ capabilityId: DOMAIN_MEDIA_CAPABILITIES.SAVE_ARTIFACT.id },
			{ capabilityId: DOMAIN_MEDIA_CAPABILITIES.RELEASE_ARTIFACT.id },
		]);
		await expect(adapter.listMediaProviders(sessionId)).resolves.toHaveLength(1);
		await expect(
			adapter.createMediaJob(sessionId, {
				providerId: "desktop-app:vetta",
				kind: "image",
				mode: "text-to-image",
				prompt: "draw a fox",
			}),
		).resolves.toMatchObject({ providerId: "desktop-app:vetta", status: "succeeded" });

		permissions = [];
		expect(() => adapter.listMediaProviders(sessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});

	it("qualifies plugin blob references with the current plugin namespace", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [
				PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE,
				PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ,
			],
		});
		const sessionId = adapter.openSession("media-consumer");

		await adapter.createMediaJob(sessionId, {
			providerId: "desktop-app:vetta",
			kind: "image",
			mode: "image-to-image",
			prompt: "edit",
			references: [
				{
					id: "reference-1",
					kind: "image",
					mimeType: "image/png",
					source: { type: "plugin-blob", blobId: "blob-1" },
				},
			],
		});

		expect(access.invocations.at(-1)).toMatchObject({
			capabilityId: DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.id,
			input: {
				references: [
					{
						source: { type: "plugin-blob", namespace: "media-consumer", blobId: "blob-1" },
					},
				],
			},
		});
	});

	it("enforces source read permissions before invoking the provider", async () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE],
		});
		const sessionId = adapter.openSession("media-consumer");

		expect(() =>
			adapter.createMediaJob(sessionId, {
				providerId: "desktop-app:vetta",
				kind: "image",
				mode: "image-to-image",
				prompt: "edit",
				references: [{ kind: "image", source: { type: "plugin-blob", blobId: "blob-1" } }],
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }));
		expect(access.invocations).toHaveLength(0);
	});

	it("qualifies artifact destinations and enforces destination write permissions", async () => {
		const access = new RecordingAccessFactory();
		let permissions: readonly string[] = [
			PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE,
			PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE,
		];
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => permissions,
		});
		const sessionId = adapter.openSession("media-consumer");

		await adapter.saveMediaArtifact(sessionId, {
			artifactId: "artifact-1",
			destination: { type: "plugin-blob", blobId: "result-1" },
		});
		expect(access.invocations.at(-1)).toEqual({
			capabilityId: DOMAIN_MEDIA_CAPABILITIES.SAVE_ARTIFACT.id,
			input: {
				artifactId: "artifact-1",
				destination: {
					type: "plugin-blob",
					namespace: "media-consumer",
					blobId: "result-1",
				},
			},
		});

		permissions = [PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE];
		expect(() =>
			adapter.saveMediaArtifact(sessionId, {
				artifactId: "artifact-2",
				destination: { type: "workspace-file", path: "C:/workspace/output.png" },
			}),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }));
	});
});
