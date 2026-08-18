import { CAPABILITY_ERROR_CODES } from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITY_PERMISSIONS, PluginCapabilityAdapter } from "../index.js";
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

	it("keeps the previous session active until its reload activation is explicitly closed", () => {
		const access = new RecordingAccessFactory();
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ],
		});
		const firstSessionId = adapter.openSession("reloadable");
		const secondSessionId = adapter.openSession("reloadable");

		expect(() => adapter.readFile(firstSessionId, "C:/project/file.txt")).not.toThrow();
		expect(() => adapter.readFile(secondSessionId, "C:/project/file.txt")).not.toThrow();

		adapter.closeSession(firstSessionId);
		expect(() => adapter.readFile(firstSessionId, "C:/project/file.txt")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.SESSION_REVOKED }),
		);
		expect(() => adapter.readFile(secondSessionId, "C:/project/file.txt")).not.toThrow();

		adapter.closeSession(secondSessionId);
		expect(() => adapter.readFile(secondSessionId, "C:/project/file.txt")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.SESSION_REVOKED }),
		);
	});

	it("revokes sessions left by an older renderer document", () => {
		const adapter = new PluginCapabilityAdapter(new RecordingAccessFactory(), {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ],
		});
		const oldSessionId = adapter.openSession("reloadable", "web-1:frame-1");
		const replacementSessionId = adapter.openSession("reloadable", "web-1:frame-2");

		expect(() => adapter.readFile(oldSessionId, "C:/project/file.txt")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.SESSION_REVOKED }),
		);
		expect(() => adapter.readFile(replacementSessionId, "C:/project/file.txt")).not.toThrow();
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
