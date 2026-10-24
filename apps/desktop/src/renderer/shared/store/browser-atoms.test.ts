// @vitest-environment jsdom

import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { activityPanelOpenAtom, activityPanelTabByProjectAtom, attachedPluginTabsAtom } from "./activity-atoms";
import { browserUrlByWorkspaceAtom, openUrlInActivityWorkspaceAtom } from "./browser-atoms";

describe("workspace browser state", () => {
	it("opens and remembers URLs under an explicit workspace without reading active conversation state", () => {
		const store = createStore();
		store.set(openUrlInActivityWorkspaceAtom, {
			workspaceId: "agent-team:delivery",
			url: "https://example.com/team",
		});

		expect(store.get(browserUrlByWorkspaceAtom).get("agent-team:delivery")).toBe("https://example.com/team");
		expect(store.get(activityPanelTabByProjectAtom).get("agent-team:delivery")).toBe("browser");
		expect(store.get(activityPanelOpenAtom)).toBe(true);
	});

	it("attaches the builtin browser tab so the preview has somewhere to show up", () => {
		const store = createStore();
		store.set(openUrlInActivityWorkspaceAtom, { workspaceId: "/repo", url: "https://example.com" });

		expect(store.get(attachedPluginTabsAtom).get("/repo")).toEqual(["browser"]);
	});

	it("leaves the attach record untouched when the tab is already attached", () => {
		const store = createStore();
		const before = new Map([["/repo", ["browser"]]]);
		store.set(attachedPluginTabsAtom, before);

		store.set(openUrlInActivityWorkspaceAtom, { workspaceId: "/repo", url: "https://example.com/next" });

		expect(store.get(attachedPluginTabsAtom)).toBe(before);
	});
});
