import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeConversationSessionId } from "../../src/conversation/conversation-file-codec.js";
import { resolveSessionIdFromPath } from "../../src/conversation/conversation-file-path.js";

describe("conversation file paths", () => {
	it("resolves a canonical direct-child conversation path", () => {
		const conversationDir = join(process.cwd(), "sessions");
		const sessionId = "session/会话-1";
		const encoded = encodeConversationSessionId(sessionId);

		expect(resolveSessionIdFromPath(conversationDir, join(conversationDir, `${encoded}.conversation.jsonl`))).toBe(
			sessionId,
		);
	});

	it("rejects non-native, nested, outside and non-canonical paths", () => {
		const conversationDir = join(process.cwd(), "sessions");
		const encoded = encodeConversationSessionId("session-1");

		expect(resolveSessionIdFromPath(conversationDir, conversationDir)).toBeUndefined();
		expect(resolveSessionIdFromPath(conversationDir, join(conversationDir, "legacy.jsonl"))).toBeUndefined();
		expect(
			resolveSessionIdFromPath(conversationDir, join(conversationDir, "nested", `${encoded}.conversation.jsonl`)),
		).toBeUndefined();
		expect(
			resolveSessionIdFromPath(conversationDir, join(conversationDir, "..", `${encoded}.conversation.jsonl`)),
		).toBeUndefined();
		expect(resolveSessionIdFromPath(conversationDir, join(conversationDir, "*.conversation.jsonl"))).toBeUndefined();
	});
});
