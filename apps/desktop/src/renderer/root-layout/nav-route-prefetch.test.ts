import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loaders = vi.hoisted(() => ({
	abilities: vi.fn(async () => ({})),
	agents: vi.fn(async () => ({})),
	automation: vi.fn(async () => ({})),
	batch: vi.fn(async () => ({})),
	knowledge: vi.fn(async () => ({})),
	newSession: vi.fn(async () => ({})),
	workspace: vi.fn(async () => ({})),
	scenes: vi.fn(async () => ({})),
	settings: vi.fn(async () => ({})),
}));

vi.mock("../route-page-loaders", () => ({
	loadAbilitiesPage: loaders.abilities,
	loadAgentCenterPage: loaders.agents,
	loadAutomationPage: loaders.automation,
	loadBatchTasksPage: loaders.batch,
	loadKnowledgeBasePage: loaders.knowledge,
	loadNewSessionPage: loaders.newSession,
	loadPluginWorkspaceViewRoute: loaders.workspace,
	loadScenesPage: loaders.scenes,
	loadSettingsPage: loaders.settings,
}));

import {
	commandMenuPageLoader,
	navItemPageLoader,
	prefetchCommandMenuAction,
	prefetchNavItem,
} from "./nav-route-prefetch";

function item(overrides: Partial<SidebarNavItem>): SidebarNavItem {
	return { key: "test", icon: "", active: false, type: "route", ...overrides };
}

beforeEach(() => {
	for (const load of Object.values(loaders)) load.mockReset().mockResolvedValue({});
});

describe("sidebar route code prefetch", () => {
	it("loads only the selected page module while leaving navigation to the click handler", () => {
		prefetchNavItem(item({ type: "new-session" }));
		prefetchNavItem(item({ path: "/agents" }));
		prefetchNavItem(item({ settingsTab: "general" }));
		prefetchNavItem(item({ workspaceView: { pluginId: "design", viewId: "gallery" } }));

		expect(loaders.newSession).toHaveBeenCalledOnce();
		expect(loaders.agents).toHaveBeenCalledOnce();
		expect(loaders.settings).toHaveBeenCalledOnce();
		expect(loaders.workspace).toHaveBeenCalledOnce();
		expect(loaders.abilities).not.toHaveBeenCalled();
	});

	it("does not prefetch unknown entries and maps legacy links to their destination", () => {
		expect(navItemPageLoader(item({ path: "/skills" }))).toBe(loaders.abilities);
		expect(navItemPageLoader(item({ path: "/plugins" }))).toBe(loaders.abilities);
		expect(navItemPageLoader(item({}))).toBeNull();
	});

	it("prepares code for selected command menu destinations", () => {
		prefetchCommandMenuAction({ kind: "openSettingsSection" });
		prefetchCommandMenuAction({ kind: "openAbilities" });
		prefetchCommandMenuAction({ kind: "openWorkspaceView" });
		prefetchCommandMenuAction({ kind: "openSession" });
		expect(loaders.settings).toHaveBeenCalledOnce();
		expect(loaders.abilities).toHaveBeenCalledOnce();
		expect(loaders.workspace).toHaveBeenCalledOnce();
		expect(commandMenuPageLoader("openSession")).toBeNull();
	});

	it("a failed hover remains retryable on the next intent", async () => {
		loaders.scenes.mockRejectedValueOnce(new Error("chunk unavailable"));
		const scene = item({ path: "/scenes" });
		prefetchNavItem(scene);
		await Promise.resolve();
		prefetchNavItem(scene);
		expect(loaders.scenes).toHaveBeenCalledTimes(2);
	});
});
