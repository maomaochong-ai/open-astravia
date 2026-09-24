import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONVERSATION_CWD } from "../config/desktop-config-store.js";
import type { ConversationListChangedEvent } from "./conversation-list-events.js";
import { createDesktopSessionCommands } from "./desktop-session-commands.js";

function setup(cwd: string | undefined) {
	const calls: string[] = [];
	const events: ConversationListChangedEvent[] = [];
	const deleted: Array<(path: string) => boolean> = [];
	const commands = createDesktopSessionCommands({
		runtime: {
			deleteSession: vi.fn(async (path: string) => void calls.push(`delete ${path}`)),
			renameSession: vi.fn(async (path: string, name: string) => void calls.push(`rename ${path} ${name}`)),
		},
		onSessionsDeleted: (isDeleted) => deleted.push(isDeleted),
		forgetAnnotations: async (path) => void calls.push(`annotations ${path}`),
		assertOrdinary: async (path) => void calls.push(`assert ${path}`),
		readSessionCwd: async () => cwd,
		removeDirectory: vi.fn(async (dir: string) => void calls.push(`rm ${dir}`)),
		forgetUserMarks: (paths) => void calls.push(`forget ${paths.join(",")}`),
		emitListChanged: (event) => void events.push(event),
	});
	return { commands, calls, events, deleted };
}

describe("desktop session commands", () => {
	it("deletes a conversation with its workspace, marks and automations, then tells the list", async () => {
		const sub = join(DEFAULT_CONVERSATION_CWD, "0b6f4c2e-1d2a-4e0b-9c1a-2f3e4d5c6b7a");
		const { commands, calls, events, deleted } = setup(sub);
		await commands.delete("/s/a.jsonl");
		expect(calls).toEqual([
			"assert /s/a.jsonl",
			"delete /s/a.jsonl",
			"annotations /s/a.jsonl",
			"forget /s/a.jsonl",
			`rm ${sub}`,
		]);
		expect(deleted).toHaveLength(1);
		expect(deleted[0]("/s/a.jsonl")).toBe(true);
		expect(deleted[0]("/s/b.jsonl")).toBe(false);
		expect(events).toEqual([{ cwd: DEFAULT_CONVERSATION_CWD, sessionPath: "/s/a.jsonl" }]);
	});

	it("keeps a project's directory and lists the change under the project", async () => {
		const { commands, calls, events } = setup("/code/vetta");
		await commands.delete("/s/a.jsonl");
		expect(calls.some((call) => call.startsWith("rm "))).toBe(false);
		expect(events).toEqual([{ cwd: "/code/vetta", sessionPath: "/s/a.jsonl" }]);
	});

	it("renames only ordinary sessions and tells the list", async () => {
		const { commands, calls, events } = setup("/code/vetta");
		await commands.rename("/s/a.jsonl", "周报");
		expect(calls).toEqual(["assert /s/a.jsonl", "rename /s/a.jsonl 周报"]);
		expect(events).toEqual([{ cwd: "/code/vetta", sessionPath: "/s/a.jsonl" }]);
	});

	it("stops before touching anything when the session belongs to a team", async () => {
		const deleteSession = vi.fn(async () => undefined);
		const commands = createDesktopSessionCommands({
			runtime: { deleteSession, renameSession: vi.fn(async () => undefined) },
			onSessionsDeleted: vi.fn(),
			forgetAnnotations: vi.fn(),
			assertOrdinary: async () => {
				throw new Error("Conversation is managed by Agent Team: t/s");
			},
			readSessionCwd: async () => "/code",
			forgetUserMarks: vi.fn(),
			emitListChanged: vi.fn(),
		});
		await expect(commands.delete("/s/a.jsonl")).rejects.toThrow("Agent Team");
		expect(deleteSession).not.toHaveBeenCalled();
	});
});
