import {
	CAPABILITY_CONSTRAINT_KINDS,
	CAPABILITY_ERROR_CODES,
	FOUNDATION_BROWSER_CAPABILITIES,
} from "@vetta/capability-sdk";
import { describe, expect, it } from "vitest";
import { PLUGIN_CAPABILITY_PERMISSIONS, PluginCapabilityAdapter } from "../index.js";
import { RecordingAccessFactory } from "./helpers/recording-access-factory.js";

function createAdapter(input: { permissions: readonly string[]; official?: boolean }) {
	const access = new RecordingAccessFactory();
	const adapter = new PluginCapabilityAdapter(access, {
		isOfficialPlugin: () => input.official === true,
		resolvePermissions: () => input.permissions,
		resolveBrowserAllowedHosts: () => ["example.com"],
	});
	return { access, adapter, sessionId: adapter.openSession("publisher") };
}

describe("PluginCapabilityAdapter browser permissions", () => {
	it("grants exact namespaced read/interact capabilities and injects manifest hosts", async () => {
		const { access, adapter, sessionId } = createAdapter({
			permissions: [PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_READ, PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_INTERACT],
		});
		const namespaceConstraint = {
			kind: CAPABILITY_CONSTRAINT_KINDS.NAMESPACE,
			value: "publisher",
		};
		expect(access.sessions[0]?.grants).toEqual(
			[
				FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS,
				FOUNDATION_BROWSER_CAPABILITIES.SESSION_CREATE,
				FOUNDATION_BROWSER_CAPABILITIES.SESSION_GET,
				FOUNDATION_BROWSER_CAPABILITIES.SESSION_CLOSE,
				FOUNDATION_BROWSER_CAPABILITIES.NAVIGATE,
				FOUNDATION_BROWSER_CAPABILITIES.SNAPSHOT,
				FOUNDATION_BROWSER_CAPABILITIES.READ_TEXT,
				FOUNDATION_BROWSER_CAPABILITIES.SCREENSHOT,
				FOUNDATION_BROWSER_CAPABILITIES.ACT,
			].map((capability) => ({ capabilityId: capability.id, constraints: [namespaceConstraint] })),
		);

		await adapter.createBrowserSession(sessionId, {
			namespace: "forged",
			allowedHosts: ["example.com"],
			headed: false,
		});
		expect(access.invocations.at(-1)).toEqual({
			capabilityId: FOUNDATION_BROWSER_CAPABILITIES.SESSION_CREATE.id,
			input: {
				namespace: "publisher",
				allowedHosts: ["example.com"],
				headed: false,
			},
		});
	});

	it("allows runtime narrowing but rejects expansion beyond manifest hosts", async () => {
		const { adapter, sessionId } = createAdapter({
			permissions: [PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_READ],
		});
		await expect(adapter.createBrowserSession(sessionId, { allowedHosts: ["example.com"] })).resolves.toBeDefined();
		expect(() => adapter.createBrowserSession(sessionId, { allowedHosts: ["other.example"] })).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
	});

	it("requires explicit persistent-profile permission", () => {
		const { adapter, sessionId } = createAdapter({ permissions: [PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_READ] });
		expect(() =>
			adapter.createBrowserSession(sessionId, { profile: { type: "persistent", id: "account-a" } }),
		).toThrowError(expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }));
	});

	it("allows attach and runtime management when explicitly granted", async () => {
		const permissions = [
			PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_READ,
			PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_ATTACH,
			PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_RUNTIME_MANAGE,
		];
		const community = createAdapter({ permissions });
		await expect(
			community.adapter.createBrowserSession(community.sessionId, { source: "attach" }),
		).resolves.toHaveProperty("id", "browser-session");
		await expect(community.adapter.installBrowserRuntime(community.sessionId, "runtime")).resolves.toMatchObject({
			phase: "ready",
		});
	});

	it("tracks browser sessions per activation and transfers a reused profile session to the replacement", async () => {
		const access = new RecordingAccessFactory();
		const released: Array<{ pluginId: string; ids: readonly string[] }> = [];
		const adapter = new PluginCapabilityAdapter(access, {
			isOfficialPlugin: () => false,
			resolvePermissions: () => [PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_READ],
			resolveBrowserAllowedHosts: () => ["example.com"],
			onBrowserSessionsReleased: (pluginId, ids) => released.push({ pluginId, ids }),
		});
		const previous = adapter.openSession("publisher");
		await adapter.createBrowserSession(previous, {});
		const replacement = adapter.openSession("publisher");
		await adapter.createBrowserSession(replacement, {});

		expect(() => adapter.getBrowserSession(previous, "browser-session")).toThrowError(
			expect.objectContaining({ code: CAPABILITY_ERROR_CODES.ACCESS_DENIED }),
		);
		await expect(adapter.getBrowserSession(replacement, "browser-session")).resolves.toBeDefined();

		adapter.closeSession(previous);
		expect(released).toEqual([]);
		adapter.closeSession(replacement);
		expect(released).toEqual([{ pluginId: "publisher", ids: ["browser-session"] }]);
	});
});
