// @vitest-environment jsdom
import type { SessionInfo } from "@shared/store/atoms";
import { conversationTagsAtom, tagConversationFilter } from "@shared/store/atoms";
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SidebarConversationInfo } from "../services/sidebar-conversation-projection";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

const { useDefaultSessionListModel } = await import("./useDefaultSessionListModel.js");

const CWD = "/home/user/.vetta/desktop-app/conversation";

function session(path: string): SidebarConversationInfo {
	return {
		kind: "conversation",
		id: path,
		path,
		cwd: CWD,
		firstMessage: path,
		modifiedAt: 1,
	} satisfies { kind: "conversation" } & SessionInfo;
}

const TAGGED = session(`${CWD}/tagged.jsonl`);
const PLAIN = session(`${CWD}/plain.jsonl`);

function renderModel(filter: Parameters<typeof useDefaultSessionListModel>[0]["filter"]) {
	const store = createStore();
	store.set(conversationTagsAtom, {
		tags: [{ id: "t1", name: "重要", color: "#ff5f57", createdAt: 1 }],
		assignments: { [TAGGED.path]: ["t1"] },
	});
	const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
	return renderHook(
		() =>
			useDefaultSessionListModel({
				activeSessionPath: "",
				activeTeamSessionId: "",
				cwd: CWD,
				filter,
				onRenameSession: () => {},
				onSelectSession: () => {},
				sessions: [TAGGED, PLAIN],
			}),
		{ wrapper },
	);
}

describe("useDefaultSessionListModel tag filtering", () => {
	it("keeps tagged conversations in the unfiltered conversation tier", () => {
		const { result } = renderModel("conversation");
		expect(result.current.sessions.map((view) => view.path)).toEqual([TAGGED.path, PLAIN.path]);
	});

	it("narrows the list to the selected tag", () => {
		const { result } = renderModel(tagConversationFilter("t1"));
		expect(result.current.sessions.map((view) => view.path)).toEqual([TAGGED.path]);
	});

	it("shows nothing for a tag no conversation carries", () => {
		const { result } = renderModel(tagConversationFilter("t-unknown"));
		expect(result.current.sessions).toEqual([]);
		expect(result.current.labels.emptyTitle).toBe("sidebar.defaultConversation.emptyTagTitle");
		// 标签档下不提供「开始新对话」——新建的会话不会属于这个标签。
		expect(result.current.actions.emptyAction).toBeUndefined();
	});
});
