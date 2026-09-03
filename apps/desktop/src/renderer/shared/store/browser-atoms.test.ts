// @vitest-environment jsdom

import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { activityPanelOpenAtom, activityPanelTabByProjectAtom } from "./activity-atoms";
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
});
