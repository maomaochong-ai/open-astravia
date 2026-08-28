import {
	type BrowserActionResult,
	type BrowserPageState,
	type BrowserRuntimeStatus,
	type BrowserScreenshot,
	type BrowserSession,
	type BrowserSnapshot,
	type BrowserTextContent,
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	FOUNDATION_BROWSER_CAPABILITIES,
} from "@vetta/capability-sdk";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

function normalizeRequestedHost(value: string): string {
	const raw = value.trim().toLowerCase();
	if (raw === "*") return raw;
	const wildcard = raw.startsWith("*.");
	const host = wildcard ? raw.slice(2) : raw;
	if (!host || host.includes("*") || /[\\/?#@:]/.test(host)) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.INVALID_INPUT, `Invalid browser allowed host: ${value}`);
	}
	return wildcard ? `*.${host.replace(/\.$/, "")}` : host.replace(/\.$/, "");
}

function hostGrantCovers(grant: string, requested: string): boolean {
	if (grant === "*") return true;
	if (requested === "*") return false;
	if (!grant.startsWith("*.")) return grant === requested;
	const grantBase = grant.slice(2);
	const requestedBase = requested.startsWith("*.") ? requested.slice(2) : requested;
	return requestedBase === grantBase || requestedBase.endsWith(`.${grantBase}`);
}

function effectiveAllowedHosts(manifestHosts: readonly string[], requested: unknown): string[] {
	if (requested === undefined) return [...manifestHosts];
	if (!Array.isArray(requested) || requested.length === 0 || !requested.every((value) => typeof value === "string")) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.INVALID_INPUT,
			"Browser session allowedHosts must be a non-empty string array",
		);
	}
	const normalized = [...new Set(requested.map(normalizeRequestedHost))];
	if (!normalized.every((host) => manifestHosts.some((grant) => hostGrantCovers(grant, host)))) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.ACCESS_DENIED,
			"Browser session allowedHosts exceeds the plugin manifest grant",
		);
	}
	return normalized;
}

function objectInput(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? { ...(value as Record<string, unknown>) }
		: {};
}

function readSession(access: PluginCapabilitySessionAccess, sessionId: string) {
	return access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_READ });
}

function readOwnedSession(access: PluginCapabilitySessionAccess, sessionId: string, browserSessionId: string) {
	const session = readSession(access, sessionId);
	access.assertBrowserSessionOwned(sessionId, browserSessionId);
	return session;
}

export const pluginBrowserMethods = {
	getBrowserRuntimeStatus(this: PluginCapabilitySessionAccess, sessionId: string): Promise<BrowserRuntimeStatus> {
		const session = readSession(this, sessionId);
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_STATUS, {
			namespace: session.pluginId,
		});
	},

	installBrowserRuntime(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		step: unknown,
	): Promise<BrowserRuntimeStatus> {
		const session = this.session(sessionId, {
			permission: PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_RUNTIME_MANAGE,
		});
		const input = FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_INSTALL.parseInput({
			namespace: session.pluginId,
			step,
		});
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.RUNTIME_INSTALL, input);
	},

	createBrowserSession(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		options: unknown,
	): Promise<BrowserSession> {
		const session = readSession(this, sessionId);
		const rawOptions = objectInput(options);
		const allowedHosts = effectiveAllowedHosts(this.browserAllowedHosts(session.pluginId), rawOptions.allowedHosts);
		const input = FOUNDATION_BROWSER_CAPABILITIES.SESSION_CREATE.parseInput({
			...rawOptions,
			namespace: session.pluginId,
			allowedHosts,
		});
		if (input.profile?.type === "persistent") {
			this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_PROFILE_PERSIST });
		}
		if (input.source === "attach") {
			this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_ATTACH });
		}
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.SESSION_CREATE, input).then((created) => {
			this.claimBrowserSession(sessionId, created.id);
			return created;
		});
	},

	getBrowserSession(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		browserSessionId: string,
	): Promise<BrowserSession> {
		const session = readOwnedSession(this, sessionId, browserSessionId);
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.SESSION_GET, {
			namespace: session.pluginId,
			sessionId: browserSessionId,
		});
	},

	closeBrowserSession(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		browserSessionId: string,
	): Promise<undefined> {
		const session = readOwnedSession(this, sessionId, browserSessionId);
		return session.access.client
			.invoke(FOUNDATION_BROWSER_CAPABILITIES.SESSION_CLOSE, {
				namespace: session.pluginId,
				sessionId: browserSessionId,
			})
			.then((result) => {
				this.releaseBrowserSession(sessionId, browserSessionId);
				return result;
			});
	},

	navigateBrowser(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		browserSessionId: string,
		url: string,
	): Promise<BrowserPageState> {
		const session = readOwnedSession(this, sessionId, browserSessionId);
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.NAVIGATE, {
			namespace: session.pluginId,
			sessionId: browserSessionId,
			url,
		});
	},

	snapshotBrowser(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		browserSessionId: string,
		options: unknown,
	): Promise<BrowserSnapshot> {
		const session = readOwnedSession(this, sessionId, browserSessionId);
		const input = FOUNDATION_BROWSER_CAPABILITIES.SNAPSHOT.parseInput({
			...objectInput(options),
			namespace: session.pluginId,
			sessionId: browserSessionId,
		});
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.SNAPSHOT, input);
	},

	readBrowserText(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		browserSessionId: string,
		options: unknown,
	): Promise<BrowserTextContent> {
		const session = readOwnedSession(this, sessionId, browserSessionId);
		const input = FOUNDATION_BROWSER_CAPABILITIES.READ_TEXT.parseInput({
			...objectInput(options),
			namespace: session.pluginId,
			sessionId: browserSessionId,
		});
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.READ_TEXT, input);
	},

	screenshotBrowser(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		browserSessionId: string,
		options: unknown,
	): Promise<BrowserScreenshot> {
		const session = readOwnedSession(this, sessionId, browserSessionId);
		const input = FOUNDATION_BROWSER_CAPABILITIES.SCREENSHOT.parseInput({
			...objectInput(options),
			namespace: session.pluginId,
			sessionId: browserSessionId,
		});
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.SCREENSHOT, input);
	},

	actBrowser(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		browserSessionId: string,
		action: unknown,
		options: unknown,
	): Promise<BrowserActionResult> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.BROWSER_INTERACT });
		this.assertBrowserSessionOwned(sessionId, browserSessionId);
		const input = FOUNDATION_BROWSER_CAPABILITIES.ACT.parseInput({
			...objectInput(options),
			namespace: session.pluginId,
			sessionId: browserSessionId,
			action,
		});
		return session.access.client.invoke(FOUNDATION_BROWSER_CAPABILITIES.ACT, input);
	},
};

export type PluginBrowserMethods = typeof pluginBrowserMethods;
