import type { InstalledPlugin } from "@preload/api";
import type { PluginDefinition } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	registerRemotes: vi.fn(),
	loadRemote: vi.fn(),
}));

vi.mock("@module-federation/enhanced/runtime", () => ({
	createInstance: () => ({
		registerRemotes: mocks.registerRemotes,
		loadRemote: mocks.loadRemote,
	}),
}));
vi.mock("./plugin-shared-modules", () => ({ createPluginRuntimeShared: () => ({}) }));

import { loadPluginDefinition } from "./plugin-module-loader";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("loadPluginDefinition", () => {
	it("loads every plugin through its Module Federation remote", async () => {
		const activate = vi.fn<PluginDefinition["activate"]>();
		mocks.loadRemote.mockResolvedValue({ default: { activate } });
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("{}", {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const plugin = {
			id: "single-loader",
			entryUrl: "vetta-plugin://single-loader/dist/mf-manifest.json?v=1",
			moduleFederation: { remoteName: "single_loader", expose: "./plugin" },
		} as unknown as InstalledPlugin;

		const definition = await loadPluginDefinition(plugin);

		expect(fetchMock).toHaveBeenCalledWith(plugin.entryUrl, { cache: "no-store" });
		expect(mocks.registerRemotes).toHaveBeenCalledWith(
			[{ name: "single_loader", alias: "single-loader", entry: plugin.entryUrl }],
			undefined,
		);
		expect(mocks.loadRemote).toHaveBeenCalledWith("single_loader/plugin", { from: "runtime" });
		expect(definition.activate).toBe(activate);
	});
});
