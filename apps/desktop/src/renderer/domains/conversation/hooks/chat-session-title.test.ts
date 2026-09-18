// @vitest-environment jsdom

import type { SessionInfo } from "@shared/store/atoms";
import { activeSessionAtom, defaultConversationCwdAtom, sessionsMapAtom } from "@shared/store/atoms";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { chatSessionTitleAtom } from "./chat-session-title";

function session(partial: Partial<SessionInfo> & Pick<SessionInfo, "path" | "cwd">): SessionInfo {
	return {
		id: partial.id ?? "id",
		path: partial.path,
		cwd: partial.cwd,
		firstMessage: partial.firstMessage ?? "",
		modifiedAt: partial.modifiedAt ?? 0,
		name: partial.name,
	};
}

describe("chatSessionTitleAtom", () => {
	it("有会话名时用展示名", () => {
		const store = createStore();
		store.set(activeSessionAtom, {
			sessionPath: "/sessions/a.jsonl",
			cwd: "/repo/a",
			runtimeId: "rt",
		});
		store.set(
			sessionsMapAtom,
			new Map([["/repo/a", [session({ path: "/sessions/a.jsonl", cwd: "/repo/a", name: "周报" })]]]),
		);
		expect(store.get(chatSessionTitleAtom)).toBe("周报");
	});

	it("找不到会话时回退项目目录名", () => {
		const store = createStore();
		store.set(defaultConversationCwdAtom, "/default");
		store.set(activeSessionAtom, {
			sessionPath: "/sessions/missing.jsonl",
			cwd: "/repo/demo-app",
			runtimeId: "rt",
		});
		expect(store.get(chatSessionTitleAtom)).toBe("demo-app");
	});

	it("还没有会话身份时为 null，壳再用默认标题", () => {
		const store = createStore();
		store.set(activeSessionAtom, null);
		expect(store.get(chatSessionTitleAtom)).toBeNull();
	});
});
