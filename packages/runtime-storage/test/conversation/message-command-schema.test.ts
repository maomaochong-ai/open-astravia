import { describe, expect, it } from "vitest";
import { isConversationDocumentCommand } from "../../src/conversation/record-schema.js";

describe("conversation message command schema", () => {
	it("accepts strict user records and rejects role-author mismatches", () => {
		const command = {
			type: "message.append",
			record: {
				kind: "user",
				id: "message-1",
				turnId: "turn-1",
				timestamp: 1,
				author: { kind: "user", id: "local-user" },
				message: { role: "user", content: "hello", timestamp: 1 },
				attachments: [{ kind: "file", path: "C:/workspace/brief.md" }],
			},
		};

		expect(isConversationDocumentCommand(command)).toBe(true);
		expect(
			isConversationDocumentCommand({
				...command,
				record: { ...command.record, author: { kind: "agent", id: "agent" } },
			}),
		).toBe(false);
	});
});
