import { describe, expect, it } from "vitest";
import { createConversationActivityWorkspace } from "./activity-workspace";

describe("createConversationActivityWorkspace", () => {
	it("有 cwd 时用 cwd 当 id 与根目录", () => {
		expect(createConversationActivityWorkspace("/repo/a", "session-1", ["runtime-1"])).toEqual({
			id: "/repo/a",
			cwd: "/repo/a",
			runtimeIds: ["runtime-1"],
		});
	});

	// 空字符串是「还没选默认工作区」的真实取值：会话页曾经把它当 id 传下去，
	// 结果整页退化成「This page ran into a problem」。
	it("cwd 为空字符串时退回 sessionId", () => {
		expect(createConversationActivityWorkspace("", "session-1")).toEqual({
			id: "session-1",
			cwd: null,
			runtimeIds: [],
		});
	});

	it("cwd 与 sessionId 都缺失时用固定兜底 id", () => {
		expect(createConversationActivityWorkspace(null, null)).toEqual({
			id: "conversation:unbound",
			cwd: null,
			runtimeIds: [],
		});
		expect(createConversationActivityWorkspace("", "")).toEqual({
			id: "conversation:unbound",
			cwd: null,
			runtimeIds: [],
		});
	});
});
