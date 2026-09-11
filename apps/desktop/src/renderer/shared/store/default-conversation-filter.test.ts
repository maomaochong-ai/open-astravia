// @vitest-environment jsdom
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { defaultConversationFilterAtom, parseDefaultConversationFilter } from "./project-atoms";

describe("default conversation filter", () => {
	it("persists the selected filter to local storage", () => {
		const store = createStore();
		store.set(defaultConversationFilterAtom, "claw");
		expect(store.get(defaultConversationFilterAtom)).toBe("claw");
		expect(
			parseDefaultConversationFilter(
				JSON.parse(localStorage.getItem("vetta-default-conversation-filter") as string),
			),
		).toBe("claw");
	});

	it("falls back to the conversation filter for unusable stored values", () => {
		expect(parseDefaultConversationFilter(null)).toBe("conversation");
		expect(parseDefaultConversationFilter([])).toBe("conversation");
		expect(parseDefaultConversationFilter({ schemaVersion: 99, filter: "claw" })).toBe("conversation");
		expect(parseDefaultConversationFilter({ schemaVersion: 1, filter: "nope" })).toBe("conversation");
	});
});
