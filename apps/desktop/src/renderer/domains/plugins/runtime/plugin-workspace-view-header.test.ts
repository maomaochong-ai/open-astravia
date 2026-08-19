// @vitest-environment jsdom
import type { InstalledPlugin } from "@preload/api";
import { pluginWorkspaceViewHeadersAtom, workspaceViewHeaderKey } from "@shared/store/atoms";
import type { PluginPermission } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginUiApi } from "./plugin-ui-context";

const VIEW_ID = "gallery";

function installedPlugin(permissions: PluginPermission[]): InstalledPlugin {
	return {
		id: "demo-plugin",
		name: "Demo",
		permissions,
		grantedPermissions: permissions,
	} as unknown as InstalledPlugin;
}

function createUi(permissions: PluginPermission[] = ["ui.slot.workspace-view"]) {
	const contributions = new PluginLocalContributions();
	const disposers: Array<() => void> = [];
	const plugin = installedPlugin(permissions);
	const ui = createPluginUiApi({
		plugin,
		contributions,
		onChanged: () => {},
		disposers,
		agentContributions: { handlers: [] } as never,
		capabilitySessionId: "session-1",
	});
	return { contributions, disposers, plugin, ui };
}

function headerEntry(pluginId = "demo-plugin", viewId = VIEW_ID) {
	return getDefaultStore().get(pluginWorkspaceViewHeadersAtom)[workspaceViewHeaderKey(pluginId, viewId)];
}

describe("setWorkspaceViewHeader", () => {
	beforeEach(() => {
		getDefaultStore().set(pluginWorkspaceViewHeadersAtom, {});
		vi.restoreAllMocks();
	});

	it("stores the takeover for a registered view and clears it with null", () => {
		const { ui } = createUi();
		ui.registerWorkspaceView({ id: VIEW_ID, label: "Gallery", component: () => null });

		ui.setWorkspaceViewHeader(VIEW_ID, {
			hideTitle: true,
			immersive: true,
			title: "  Design  ",
			left: "left",
			right: "right",
		});
		expect(headerEntry()).toEqual({
			pluginId: "demo-plugin",
			viewId: VIEW_ID,
			title: "Design",
			hideTitle: true,
			immersive: true,
			left: "left",
			right: "right",
		});

		ui.setWorkspaceViewHeader(VIEW_ID, null);
		expect(headerEntry()).toBeUndefined();
	});

	it("ignores unknown views instead of writing an orphan entry", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { ui } = createUi();

		ui.setWorkspaceViewHeader("not-registered", { hideTitle: true });

		expect(getDefaultStore().get(pluginWorkspaceViewHeadersAtom)).toEqual({});
		expect(warn).toHaveBeenCalled();
	});

	it("requires the workspace-view permission", () => {
		const { ui } = createUi([]);
		expect(() => ui.setWorkspaceViewHeader(VIEW_ID, { hideTitle: true })).toThrow(
			"Plugin permission denied: ui.slot.workspace-view",
		);
		expect(getDefaultStore().get(pluginWorkspaceViewHeadersAtom)).toEqual({});
	});

	it("drops the takeover when the view itself is disposed", () => {
		const { ui } = createUi();
		const view = ui.registerWorkspaceView({ id: VIEW_ID, label: "Gallery", component: () => null });
		ui.setWorkspaceViewHeader(VIEW_ID, { hideTitle: true });

		view.dispose();

		expect(headerEntry()).toBeUndefined();
	});

	it("drops the takeover when the plugin is torn down, leaving other plugins alone", () => {
		const { ui, disposers } = createUi();
		ui.registerWorkspaceView({ id: VIEW_ID, label: "Gallery", component: () => null });
		ui.setWorkspaceViewHeader(VIEW_ID, { hideTitle: true });
		const store = getDefaultStore();
		const otherKey = workspaceViewHeaderKey("other-plugin", "board");
		store.set(pluginWorkspaceViewHeadersAtom, {
			...store.get(pluginWorkspaceViewHeadersAtom),
			[otherKey]: { pluginId: "other-plugin", viewId: "board", hideTitle: true },
		});

		for (const dispose of disposers) dispose();

		expect(headerEntry()).toBeUndefined();
		expect(store.get(pluginWorkspaceViewHeadersAtom)[otherKey]).toBeDefined();
	});
});
