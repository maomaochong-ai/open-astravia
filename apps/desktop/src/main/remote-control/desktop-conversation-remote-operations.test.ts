import { describe, expect, it } from "vitest";
import { DesktopConversationRemoteOperations } from "./desktop-conversation-remote-operations.js";

describe("DesktopConversationRemoteOperations", () => {
	it("creates an opaque remote session then translates a turn into protocol events", async () => {
		const session = {
			sessionId: "runtime-session-1",
			sessionPath: "C:/work/.vetta/sessions/1.jsonl",
			cwd: "C:/work",
			listCwd: "C:/work",
			source: "interactive" as const,
		};
		const conversations = {
			createSession: async () => session,
			listSessions: async () => [],
			openSession: async () => session,
			runTurn: async () => ({
				...session,
				status: "completed" as const,
				stopReason: "stop",
				assistantText: "Desktop answer",
				messageCount: 2,
			}),
		};
		const operations = new DesktopConversationRemoteOperations(conversations, { cwd: "C:/work" });
		const diagnostics = await operations.diagnostics();
		expect(diagnostics).toMatchObject({
			activeSessionCount: 0,
			cwd: "C:/work",
			osLabel: expect.any(String),
			cpu: expect.any(String),
			ram: expect.stringMatching(/(?:GB|MB)$/),
		});

		expect(await operations.createSession()).toEqual({ sessionId: "runtime-session-1" });
		const events = [];
		for await (const event of operations.prompt("runtime-session-1", "hello")) events.push(event);

		expect(events).toEqual([
			{ type: "state", payload: { state: "running" } },
			{ type: "delta", text: "Desktop answer" },
			{ type: "state", payload: { state: "completed", stopReason: "stop" } },
		]);
	});
});
