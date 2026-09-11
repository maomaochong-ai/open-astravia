// @vitest-environment jsdom
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
	conversationFilterSource,
	conversationFilterTagId,
	defaultConversationFilterAtom,
	isTagConversationFilter,
	parseDefaultConversationFilter,
	tagConversationFilter,
} from "./project-atoms";

describe("tag conversation filter", () => {
	it("round-trips a tag id through the filter value", () => {
		const filter = tagConversationFilter("t1");
		expect(isTagConversationFilter(filter)).toBe(true);
		expect(conversationFilterTagId(filter)).toBe("t1");
	});

	it("treats the tag tier as a subset of the conversation source", () => {
		expect(conversationFilterSource(tagConversationFilter("t1"))).toBe("conversation");
		expect(conversationFilterSource("claw")).toBe("claw");
		expect(conversationFilterSource("conversation")).toBe("conversation");
		expect(conversationFilterTagId("claw")).toBeNull();
	});

	it("persists and restores a tag tier across restarts", () => {
		const store = createStore();
		store.set(defaultConversationFilterAtom, tagConversationFilter("t1"));
		expect(
			parseDefaultConversationFilter(
				JSON.parse(localStorage.getItem("vetta-default-conversation-filter") as string),
			),
		).toBe("tag:t1");
	});

	it("rejects a malformed tag tier rather than restoring an unusable filter", () => {
		expect(parseDefaultConversationFilter({ schemaVersion: 1, filter: "tag:" })).toBe("conversation");
		expect(parseDefaultConversationFilter({ schemaVersion: 1, filter: "tags:t1" })).toBe("conversation");
	});
});
