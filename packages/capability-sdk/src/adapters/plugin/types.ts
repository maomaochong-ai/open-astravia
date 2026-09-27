import type { CapabilityAccessHandle } from "../../access.js";

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const PLUGIN_CAPABILITY_PERMISSIONS = {
	BROWSER_RUNTIME_MANAGE: "browser.runtime.manage",
	BROWSER_READ: "browser.read",
	BROWSER_INTERACT: "browser.interact",
	BROWSER_PROFILE_PERSIST: "browser.profile.persist",
	BROWSER_ATTACH: "browser.attach",
	FILESYSTEM_READ: "fs.read",
	FILESYSTEM_WRITE: "fs.write",
	NETWORK_FETCH: "network.fetch",
	STORAGE_READ: "storage.read",
	STORAGE_WRITE: "storage.write",
} as const;

export interface PluginCapabilityAdapterOptions {
	readonly isOfficialPlugin: (pluginId: string) => boolean;
	readonly resolvePermissions: (pluginId: string) => readonly string[];
	/** 读取 plugin manifest 声明的 browser.allowedHosts 通配符列表。空数组 = 未声明。 */
	readonly resolveBrowserAllowedHosts?: (pluginId: string) => readonly string[];
}

export interface PluginCapabilitySession {
	readonly access: CapabilityAccessHandle;
	readonly pluginId: string;
	/** 本 capability session 拥有的 browser session id 集合（用于 ownership 检查）。 */
	browserSessionIds?: Set<string>;
}

export interface PluginCapabilityRequirement {
	readonly official?: boolean;
	readonly permission?: string;
}

/** Internal session/permission resolution used by method modules. */
export interface PluginCapabilitySessionAccess {
	client(sessionId: string, requirement: PluginCapabilityRequirement): CapabilityAccessHandle["client"];
	session(sessionId: string, requirement: PluginCapabilityRequirement): PluginCapabilitySession;
	/** 声明某个 browser session id 由当前 activation 拥有。 */
	claimBrowserSession(sessionId: string, browserSessionId: string): void;
	/** 释放 ownership 记录（session 关闭时调用）。 */
	releaseBrowserSession(sessionId: string, browserSessionId: string): void;
	/** 断言 browser session 属于当前 activation，否则抛 ACCESS_DENIED。 */
	assertBrowserSessionOwned(sessionId: string, browserSessionId: string): void;
	/** 读取 plugin manifest 声明的 browser allowed hosts 通配符列表。 */
	browserAllowedHosts(pluginId: string): readonly string[];
}
