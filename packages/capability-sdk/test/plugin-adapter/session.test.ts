import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITY_PERMISSIONS, PluginCapabilityAdapter } from "../../src/adapters/plugin/index.js";
import { CAPABILITY_ERROR_CODES } from "../../src/contracts.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

describe("PluginCapabilityAdapter session lifecycle", () => {
	it("checks current permissions on every invocation", () => {
		const access = new RecordingAccessFactory();
		let permissions: readonly string[] = [PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ];
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => permissions,
		});
		const sessionId = adapter.openSession("revocable");

		permissions = [];

		expect(() => adapter.readFile(sessionId, "C:/project/file.txt")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});

	it("revokes the previous session when the same plugin is opened again", () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ],
		});
		const firstSessionId = adapter.openSession("reloadable");
		const secondSessionId = adapter.openSession("reloadable");

		expect(() => adapter.readFile(firstSessionId, "C:/project/file.txt")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.SESSION_REVOKED }),
		);
		expect(() => adapter.readFile(secondSessionId, "C:/project/file.txt")).not.toThrow();

		adapter.closeSession(secondSessionId);
		expect(() => adapter.readFile(secondSessionId, "C:/project/file.txt")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.SESSION_REVOKED }),
		);
	});

	it("resolves the owning plugin id only for active sessions", () => {
		const adapter = new PluginCapabilityAdapter(new RecordingAccessFactory(), {
			isOfficialPlugin: (pluginId) => pluginId === "official-plugin",
			resolvePermissions: () => [],
		});
		const communitySessionId = adapter.openSession("community-plugin");
		const officialSessionId = adapter.openSession("official-plugin");

		expect(adapter.pluginIdForSession(communitySessionId)).toBe("community-plugin");
		expect(adapter.pluginIdForSession(officialSessionId, { official: true })).toBe("official-plugin");
		expect(() => adapter.pluginIdForSession(communitySessionId, { official: true })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);

		adapter.closeSession(communitySessionId);
		expect(() => adapter.pluginIdForSession(communitySessionId)).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.SESSION_REVOKED }),
		);
	});
});
