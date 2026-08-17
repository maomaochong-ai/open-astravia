import { describe, expect, it } from "vitest";
import { CONVERSATION_STORAGE_ERROR_CODES, InMemoryConversationRepository } from "../../src/conversation/index.js";

describe("InMemoryConversationRepository", () => {
	it("implements repository and document semantics without a filesystem path", async () => {
		const repository = new InMemoryConversationRepository();
		await repository.create({ sessionId: "memory-session", createdAt: 1, cwd: "C:\\workspace" });

		await repository.append("memory-session", 0, [
			{
				type: "message.appended",
				sessionId: "memory-session",
				turnId: "turn-1",
				message: { role: "user", content: "hello", timestamp: 2 },
				timestamp: 2,
			},
		]);
		const beforeRename = await repository.readDocument("memory-session");
		await repository.execute("memory-session", null, { type: "session.name.set", name: "In memory" });

		expect(repository.resolveConversationPath("memory-session")).toBe("memory://conversation/memory-session");
		expect(await repository.load("memory-session")).toMatchObject({
			sessionId: "memory-session",
			version: 1,
			messages: [{ role: "user", content: "hello" }],
		});
		expect(await repository.readDocument("memory-session")).toMatchObject({
			revision: beforeRename.revision + 1,
			name: "In memory",
			identity: { cwd: "C:\\workspace" },
		});
	});

	it("preserves duplicate, version and closed repository errors", async () => {
		const repository = new InMemoryConversationRepository();
		await repository.create({ sessionId: "memory-session", createdAt: 1 });

		await expect(repository.create({ sessionId: "memory-session", createdAt: 1 })).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS,
		});
		await expect(repository.append("memory-session", 1, [])).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT,
		});
		await repository.close();
		await expect(repository.load("memory-session")).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.CLOSED,
		});
	});
});
