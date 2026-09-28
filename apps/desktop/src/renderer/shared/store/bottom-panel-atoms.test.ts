// @vitest-environment jsdom

import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { bottomPanelStateAtomFamily, dispatchBottomPanelAtomFamily } from "./bottom-panel-atoms";

describe("bottom-panel work-surface scopes", () => {
	it("isolates layout state by an explicit surface key without an active Conversation", () => {
		const store = createStore();
		const teamScope = "agent-team:team-session";
		const conversationScope = "/sessions/conversation.jsonl";

		store.set(dispatchBottomPanelAtomFamily(teamScope), {
			type: "open-tab",
			tabId: "team-terminal",
			componentId: "builtin:terminal",
			newLeafId: "team-leaf",
		});

		expect(store.get(bottomPanelStateAtomFamily(teamScope)).root).not.toBeNull();
		expect(store.get(bottomPanelStateAtomFamily(conversationScope)).root).toBeNull();
	});
});
