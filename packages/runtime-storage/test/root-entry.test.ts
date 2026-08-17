import { describe, expect, it } from "vitest";
import * as conversation from "../src/conversation/index.js";
import * as root from "../src/index.js";

describe("runtime-storage root entry", () => {
	it("publishes protocol errors and schema versions", () => {
		expect(root.ConversationStorageError).toBe(conversation.ConversationStorageError);
		expect(root.CONVERSATION_SCHEMA_VERSION).toBe(conversation.CONVERSATION_SCHEMA_VERSION);
	});

	it("does not publish concrete adapters or retired compatibility objects", () => {
		expect("FileConversationRepository" in root).toBe(false);
		expect("InMemoryConversationRepository" in root).toBe(false);
		expect("migrateLegacySessionToV2" in root).toBe(false);
		expect("AuthStorage" in root).toBe(false);
		expect("SessionManager" in root).toBe(false);
		expect("SettingsManager" in root).toBe(false);
	});
});
