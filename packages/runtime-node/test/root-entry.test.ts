import { describe, expect, it } from "vitest";
import * as conversation from "../src/conversation/index.js";
import * as root from "../src/index.js";

describe("runtime-node root entry", () => {
	it("publishes Node conversation adapters", () => {
		expect(root.FileConversationRepository).toBe(conversation.FileConversationRepository);
		expect(root.InMemoryConversationRepository).toBe(conversation.InMemoryConversationRepository);
		expect(root.migrateLegacySessionToV2).toBe(conversation.migrateLegacySessionToV2);
		expect(root.parseLegacySessionDocumentSource).toBe(conversation.parseLegacySessionDocumentSource);
		expect(conversation.parseLegacySessionDocumentSource).toBeTypeOf("function");
	});
});
