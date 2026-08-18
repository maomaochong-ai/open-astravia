import type { InstalledPlugin } from "@preload/api";
import type { PluginContext, PluginDefinition } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	activate: vi.fn<PluginDefinition["activate"]>(),
	deactivate: vi.fn<NonNullable<PluginDefinition["deactivate"]>>(),
	createContext: vi.fn(() => ({}) as PluginContext),
	clearLabels: vi.fn(),
	bindSession: vi.fn(),
	closeRendererSession: vi.fn(),
}));

vi.mock("./plugin-agent-context", () => ({
	clearAgentToolLabelsForPlugin: () => {
		mocks.events.push("labels:clear");
		mocks.clearLabels();
	},
	debugPluginAgent: vi.fn(),
}));
vi.mock("./plugin-context", () => ({ createPluginContext: mocks.createContext }));
vi.mock("./plugin-host-apis", () => ({ createPluginSettingsApi: () => ({}) }));
vi.mock("./plugin-module-loader", () => ({
	loadPluginDefinition: async () => ({ activate: mocks.activate, deactivate: mocks.deactivate }),
}));
vi.mock("./plugin-renderer-capability-host", () => ({
	pluginRendererCapabilityHost: {
		bindSession: mocks.bindSession,
		closeSession: (sessionId: string) => {
			mocks.events.push(`renderer:close:${sessionId}`);
			mocks.closeRendererSession(sessionId);
		},
	},
}));
vi.mock("./plugin-style-loader", () => ({
	loadPluginStyles: () => ({ dispose: () => mocks.events.push("styles:dispose") }),
}));

import { loadPlugin } from "./plugin-loader";

const plugin = {
	id: "demo",
	name: "Demo",
	activeVersion: "1.0.0",
	runtime: "esm",
	source: "archive",
	styleUrls: [],
	defaultLocale: "zh",
	locales: {},
} as unknown as InstalledPlugin;

beforeEach(() => {
	mocks.events.length = 0;
	vi.clearAllMocks();
	vi.stubGlobal("window", {
		vetta: {
			plugins: {
				beginAgentContributionsLoad: async () => mocks.events.push("activation:begin"),
				commitAgentContributionsLoad: async () => mocks.events.push("agent:commit"),
				commitAppActionActivation: async () => mocks.events.push("activation:commit"),
				abortAppActionActivation: async () => mocks.events.push("activation:abort"),
				clearAgentContributions: async () => mocks.events.push("agent:clear"),
				getSettings: async () => ({}),
				internalCapabilities: {
					openSession: async () => "session-1",
					closeSession: async (sessionId: string) => mocks.events.push(`host:close:${sessionId}`),
				},
			},
		},
	});
});

describe("loadPlugin activation lifecycle", () => {
	it("releases plugin cleanup, host contributions, local state, and capability session in order", async () => {
		mocks.activate.mockImplementation(async () => ({
			dispose: () => mocks.events.push("activation:cleanup"),
		}));
		mocks.deactivate.mockImplementation(async () => {
			mocks.events.push("activation:deactivate");
		});

		const loaded = await loadPlugin(plugin, () => mocks.events.push("local:changed"));
		await loaded.dispose();

		expect(mocks.events).toEqual([
			"activation:begin",
			"agent:commit",
			"activation:cleanup",
			"activation:deactivate",
			"agent:clear",
			"styles:dispose",
			"labels:clear",
			"local:changed",
			"renderer:close:session-1",
			"host:close:session-1",
		]);
	});

	it("aborts pending registrations and closes local resources when activation fails", async () => {
		mocks.activate.mockRejectedValue(new Error("activate failed"));
		mocks.deactivate.mockImplementation(async () => {
			mocks.events.push("activation:deactivate");
		});

		await expect(loadPlugin(plugin, () => mocks.events.push("local:changed"))).rejects.toThrow("activate failed");
		expect(mocks.events).toEqual([
			"activation:begin",
			"activation:deactivate",
			"activation:abort",
			"agent:clear",
			"styles:dispose",
			"labels:clear",
			"local:changed",
			"renderer:close:session-1",
			"host:close:session-1",
		]);
	});
});
