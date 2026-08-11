import { describe, expect, it } from "vitest";
import * as conversation from "../src/conversation/index.js";
import * as root from "../src/index.js";

describe("runtime-storage root entry", () => {
	it("publishes the native conversation surface", () => {
		expect(root.FileConversationRepository).toBe(conversation.FileConversationRepository);
		expect(root.InMemoryConversationRepository).toBe(conversation.InMemoryConversationRepository);
		expect(root.migrateLegacySessionToV2).toBe(conversation.migrateLegacySessionToV2);
	});

	it("does not publish retired coding-agent compatibility objects", () => {
		expect("AuthStorage" in root).toBe(false);
		expect("SessionManager" in root).toBe(false);
		expect("SettingsManager" in root).toBe(false);
	});
});
