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
});
