import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../shared/store/chat-atoms";
import { resolveSessionAnchorConnection } from "./chat-session-anchor";

function message(overrides: Partial<ChatMessage>): ChatMessage {
	return {
		id: "m1",
		role: "assistant",
		text: "",
		...overrides,
	};
}

describe("resolveSessionAnchorConnection", () => {
	it("返回 undefined：无任何消息时", () => {
		expect(resolveSessionAnchorConnection([])).toBeUndefined();
	});

	it("返回 undefined：消息不含 databaseTable 锚点", () => {
		const messages = [
			message({ id: "a", role: "user", text: "hi" }),
			message({ id: "b", role: "assistant", text: "hello" }),
		];
		expect(resolveSessionAnchorConnection(messages)).toBeUndefined();
	});

	it("取最近一条携带锚点的用户消息连接（跳过中间 AI 回复）", () => {
		const messages = [
			message({
				id: "a",
				role: "user",
				text: "first",
				databaseTable: { connection: "conn-a", table: "orders" },
			}),
			message({ id: "b", role: "assistant", text: "reply" }),
			message({
				id: "c",
				role: "user",
				text: "now orders",
				databaseTable: { connection: "conn-b", table: "customers" },
			}),
			message({ id: "d", role: "assistant", text: "sql..." }),
		];
		expect(resolveSessionAnchorConnection(messages)).toBe("conn-b");
	});

	it("忽略 AI 消息上的 databaseTable（即使存在）", () => {
		const messages = [
			message({
				id: "a",
				role: "user",
				text: "ask",
				databaseTable: { connection: "conn-a", table: "orders" },
			}),
			message({
				id: "b",
				role: "assistant",
				text: "reply",
				databaseTable: { connection: "conn-b", table: "x" },
			}),
		];
		expect(resolveSessionAnchorConnection(messages)).toBe("conn-a");
	});
});
