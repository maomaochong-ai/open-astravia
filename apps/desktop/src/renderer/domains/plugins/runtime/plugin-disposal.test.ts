import { describe, expect, it, vi } from "vitest";

const logError = vi.hoisted(() => vi.fn());
vi.mock("./plugin-runtime-log", () => ({ logPluginRuntimeError: logError }));

import { disposePlugins } from "./plugin-disposal";
import type { LoadedPlugin } from "./plugin-local-contributions";

function loadedPlugin(id: string, dispose: () => Promise<void>): LoadedPlugin {
	return {
		id,
		name: id,
		version: "1.0.0",
		defaultLocale: "en",
		locales: {},
		slots: [],
		abilityDetailSlots: [],
		filePreviews: [],
		fileExplorerContextMenuActions: [],
		fileExplorerToolbarActions: [],
		fileExplorerDecorationProviders: [],
		fileIconThemes: [],
		activityTabs: [],
		bottomPanels: [],
		inputActions: [],
		newSessionContexts: [],
		cardRenderers: [],
		toolCallSlots: [],
		turnCards: [],
		workspaceViews: [],
		dispose,
	};
}

describe("disposePlugins", () => {
	it("identifies the failed plugin and still disposes the rest of the snapshot", async () => {
		const failure = new Error("cleanup failed");
		const disposeHealthy = vi.fn(async () => undefined);

		await disposePlugins(
			[
				loadedPlugin("broken", async () => {
					throw failure;
				}),
				loadedPlugin("healthy", disposeHealthy),
			],
			"snapshot-replaced",
		);

		expect(disposeHealthy).toHaveBeenCalledOnce();
		expect(logError).toHaveBeenCalledWith(
			"plugin disposal failed",
			{
				pluginId: "broken",
				pluginVersion: "1.0.0",
				stage: "dispose",
				reason: "snapshot-replaced",
			},
			failure,
		);
	});
});
