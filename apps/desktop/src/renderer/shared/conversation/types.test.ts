import { describe, expectTypeOf, it } from "vitest";
import type { ConversationAgentMessageViewModel, ConversationUserMessageViewModel } from "./types";

describe("Conversation message view models", () => {
	it("keeps role-specific capabilities out of the opposite message type", () => {
		expectTypeOf<ConversationUserMessageViewModel>().not.toHaveProperty("blocks");
		expectTypeOf<ConversationUserMessageViewModel>().not.toHaveProperty("usages");
		expectTypeOf<ConversationAgentMessageViewModel>().not.toHaveProperty("attachments");
		expectTypeOf<ConversationAgentMessageViewModel>().not.toHaveProperty("deliveryPhase");
	});
});
