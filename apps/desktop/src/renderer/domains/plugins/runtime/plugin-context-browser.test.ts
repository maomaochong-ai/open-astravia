// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	browserUrlBySessionAtom,
} from "@shared/store/atoms";
import type { PluginBrowserApi, PluginPermission } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "./plugin-context";
import { PluginLocalContributions } from "./plugin-local-contributions";

// Route navigation is an external UI effect; keep context assembly and permission checks real.
vi.mock("../../../router", () => ({ router: { navigate: vi.fn() } }));

type BrowserBridge = Window["vetta"]["plugins"]["internalCapabilities"]["browser"];

const bridge = {
	runtimeStatus: vi.fn<BrowserBridge["runtimeStatus"]>().mockResolvedValue({ phase: "ready" }),
	runtimeInstall: vi.fn<BrowserBridge["runtimeInstall"]>().mockResolvedValue({ phase: "ready" }),
	createSession: vi.fn<BrowserBridge["createSession"]>(),
	getSession: vi.fn<BrowserBridge["getSession"]>(),
	closeSession: vi.fn<BrowserBridge["closeSession"]>(),
	navigate: vi.fn<BrowserBridge["navigate"]>(),
	snapshot: vi.fn<BrowserBridge["snapshot"]>(),
	readText: vi.fn<BrowserBridge["readText"]>(),
	screenshot: vi.fn<BrowserBridge["screenshot"]>(),
	act: vi.fn<BrowserBridge["act"]>(),
} satisfies BrowserBridge;

const store = getDefaultStore();
const session = { cwd: "/project", sessionPath: "/project/session.jsonl", runtimeId: "runtime-1" };
const disposers: Array<() => void> = [];

function createContext(permissions: PluginPermission[] = [], grantedPermissions = permissions) {
	const plugin: InstalledPlugin = {
		id: "browser-test",
		name: "Browser Test",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1",
		entryUrl: "vetta-plugin://browser-test/dist/mf-manifest.json",
		moduleFederation: { remoteName: "browser_test", expose: "./plugin" },
		styleUrls: [],
		permissions,
		grantedPermissions,
		allowedNetworkHosts: [],
		allowedBrowserHosts: ["example.com"],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "en",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		source: "archive",
		trustLevel: "community",
		rootPath: "/plugins/browser-test",
	};
	return createPluginContext({
		plugin,
		contributions: new PluginLocalContributions(),
		settingsApi: { get: () => undefined, getAll: () => ({}), onChange: () => ({ dispose: () => {} }) },
		onChanged: () => {},
		disposers,
		pendingRuntimeRegistrations: [],
		activationId: "activation-1",
		capabilitySessionId: "capability-1",
	});
}

function expectNoBrowserEffects(): void {
	for (const method of Object.values(bridge)) expect(method).not.toHaveBeenCalled();
	expect(store.get(browserUrlBySessionAtom).size).toBe(0);
	expect(store.get(activityPanelOpenAtom)).toBe(false);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("vetta", { plugins: { internalCapabilities: { browser: bridge } } });
	store.set(activeSessionAtom, session);
	store.set(browserUrlBySessionAtom, new Map());
	store.set(activityPanelOpenAtom, false);
	store.set(activityPanelTabByProjectAtom, new Map());
});

afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	store.set(activeSessionAtom, null);
	store.set(browserUrlBySessionAtom, new Map());
	store.set(activityPanelOpenAtom, false);
	store.set(activityPanelTabByProjectAtom, new Map());
	vi.unstubAllGlobals();
});

describe("PluginContext browser facade", () => {
	it("always exposes browser without starting a browser or navigating", () => {
		const ctx = createContext();
		expect(ctx.browser).toBeDefined();
		expect(ctx.browser.open).toBeTypeOf("function");
		expect(ctx.browser.sessions.create).toBeTypeOf("function");
		expectNoBrowserEffects();
	});

	const deniedOperations: Array<[string, PluginPermission, (browser: PluginBrowserApi) => unknown]> = [
		["open", "browser.open", (browser) => browser.open("https://example.com")],
		["runtime.status", "browser.read", (browser) => browser.runtime.status()],
		["runtime.install", "browser.runtime.manage", (browser) => browser.runtime.install("runtime")],
		["sessions.create", "browser.read", (browser) => browser.sessions.create()],
		["sessions.get", "browser.read", (browser) => browser.sessions.get("browser-1")],
		["sessions.close", "browser.read", (browser) => browser.sessions.close("browser-1")],
		["navigate", "browser.read", (browser) => browser.navigate("browser-1", "https://example.com")],
		["snapshot", "browser.read", (browser) => browser.snapshot("browser-1")],
		["readText", "browser.read", (browser) => browser.readText("browser-1")],
		["screenshot", "browser.read", (browser) => browser.screenshot("browser-1")],
		["act", "browser.interact", (browser) => browser.act("browser-1", { type: "reload" })],
	];
	it.each(deniedOperations)("denies %s without its permission before any side effects", (_name, permission, call) => {
		const ctx = createContext();
		expect(() => call(ctx.browser)).toThrow(`Plugin permission denied: ${permission}`);
		expectNoBrowserEffects();
	});

	it("requires a permission to be both declared and granted", () => {
		for (const ctx of [createContext(["browser.open"], []), createContext([], ["browser.open"])]) {
			expect(() => ctx.browser.open("https://example.com")).toThrow("Plugin permission denied: browser.open");
		}
		expectNoBrowserEffects();
	});

	it("opens the built-in panel with only browser.open and cannot invoke automation", () => {
		const ctx = createContext(["browser.open"]);
		ctx.browser.open("example.com/posts");
		expect(store.get(browserUrlBySessionAtom).get(session.sessionPath)).toBe("https://example.com/posts");
		expect(store.get(activityPanelOpenAtom)).toBe(true);
		expect(store.get(activityPanelTabByProjectAtom).get(session.cwd)).toBe("browser");
		expect(() => ctx.browser.sessions.create()).toThrow("Plugin permission denied: browser.read");
		expect(() => ctx.browser.act("browser-1", { type: "reload" })).toThrow(
			"Plugin permission denied: browser.interact",
		);
		for (const method of Object.values(bridge)) expect(method).not.toHaveBeenCalled();
	});

	it("rejects an unapproved URL or missing active session without changing the panel", () => {
		const ctx = createContext(["browser.open"]);
		expect(() => ctx.browser.open("https://other.example")).toThrow("not allowed");
		store.set(activeSessionAtom, null);
		expect(() => ctx.browser.open("https://example.com")).toThrow("without an active session");
		expectNoBrowserEffects();
	});

	it("allows runtime installation with only its own permission", async () => {
		const ctx = createContext(["browser.runtime.manage"]);
		await expect(ctx.browser.runtime.install("runtime")).resolves.toEqual({ phase: "ready" });
		expect(bridge.runtimeInstall).toHaveBeenCalledWith("capability-1", "runtime");
		expect(() => ctx.browser.open("https://example.com")).toThrow("Plugin permission denied: browser.open");
		expect(() => ctx.browser.runtime.status()).toThrow("Plugin permission denied: browser.read");
	});

	it("preserves read access without granting open or privileged session creation", async () => {
		const ctx = createContext(["browser.read"]);
		await expect(ctx.browser.runtime.status()).resolves.toEqual({ phase: "ready" });
		expect(bridge.runtimeStatus).toHaveBeenCalledWith("capability-1");
		expect(() => ctx.browser.open("https://example.com")).toThrow("Plugin permission denied: browser.open");
		expect(() => ctx.browser.sessions.create({ profile: { type: "persistent", id: "account" } })).toThrow(
			"Plugin permission denied: browser.profile.persist",
		);
		expect(() => ctx.browser.sessions.create({ source: "attach" })).toThrow(
			"Plugin permission denied: browser.attach",
		);
		expect(bridge.createSession).not.toHaveBeenCalled();
	});
});
