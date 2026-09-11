// @vitest-environment jsdom
import { defaultConversationFilterAtom, tagConversationFilter } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyActiveTagFilterToNewConversation } from "./new-conversation-tagging";

const SESSION_PATH = "/home/user/.vetta/desktop-app/conversation/new.jsonl";

const assign = vi.fn(async () => ({ tags: [], assignments: {} }));

beforeEach(() => {
	assign.mockClear();
	Object.assign(window, { vetta: { conversationTags: { assign } } });
});

afterEach(() => {
	getDefaultStore().set(defaultConversationFilterAtom, "conversation");
});

describe("新会话继承当前标签筛选", () => {
	it("筛选停在标签档时，给新建的会话打上同一个标签", async () => {
		getDefaultStore().set(defaultConversationFilterAtom, tagConversationFilter("t1"));

		await applyActiveTagFilterToNewConversation(SESSION_PATH);

		expect(assign).toHaveBeenCalledWith({ sessionPath: SESSION_PATH, tagId: "t1", assigned: true });
	});

	it.each(["conversation", "claw"] as const)("筛选停在「%s」档时不做任何标注", async (filter) => {
		getDefaultStore().set(defaultConversationFilterAtom, filter);

		await applyActiveTagFilterToNewConversation(SESSION_PATH);

		expect(assign).not.toHaveBeenCalled();
	});

	it("拿不到会话路径时不写标注", async () => {
		getDefaultStore().set(defaultConversationFilterAtom, tagConversationFilter("t1"));

		await applyActiveTagFilterToNewConversation("");

		expect(assign).not.toHaveBeenCalled();
	});
});
