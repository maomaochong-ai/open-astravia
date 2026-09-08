import { describe, expect, it } from "vitest";
import type { LoadedPlugin } from "../runtime/plugin-loader";
import { publishWorkspaceViews } from "./plugin-workspace-view-publication";

function loadedPlugin(): LoadedPlugin {
	return {
		id: "xiaohongshu",
		name: "小红书",
		version: "1.0.9",
		defaultLocale: "zh",
		locales: {},
		slots: [],
		abilityDetailSlots: [],
		filePreviews: [],
		fileExplorerContextMenuActions: [],
		fileExplorerToolbarActions: [],
		fileExplorerDecorationProviders: [],
		activityTabs: [],
		inputActions: [],
		cardRenderers: [],
		toolCallSlots: [],
		turnCards: [],
		workspaceViews: [
			{
				id: "accounts",
				label: "小红书账号",
				icon: "vetta-plugin-nav-icon-1",
				iconUrl: "vetta-plugin://xiaohongshu/assets/icon.png?v=1.0.9",
				component: () => null,
			},
		],
		dispose: async () => {},
	};
}

describe("publishWorkspaceViews", () => {
	it("preserves the full-color icon URL alongside its theme fallback", () => {
		expect(publishWorkspaceViews([loadedPlugin()])[0]).toMatchObject({
			icon: "vetta-plugin-nav-icon-1",
			iconUrl: "vetta-plugin://xiaohongshu/assets/icon.png?v=1.0.9",
		});
	});
});
