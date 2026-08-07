import type { RuntimeSessionCatalog, SessionHistoryInfo } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { resolveImSessionPath } from "../src/rpc/im-session-selection.js";

describe("IM session selection", () => {
	it("keeps explicit and fresh session selection independent from catalog order", async () => {
		const listSessions = vi.fn(async () => []);
		const sessionCatalog = createSessionCatalog(listSessions);

		await expect(
			resolveImSessionPath({
				explicitSessionPath: "C:/sessions/explicit.conversation.jsonl",
				continueSession: true,
				cwd: "C:/workspace",
				sessionDir: "C:/sessions",
				sessionCatalog,
			}),
		).resolves.toBe("C:/sessions/explicit.conversation.jsonl");
		await expect(
			resolveImSessionPath({
				continueSession: false,
				cwd: "C:/workspace",
				sessionDir: "C:/sessions",
				sessionCatalog,
			}),
		).resolves.toBeUndefined();
		expect(listSessions).not.toHaveBeenCalled();
	});

	it("selects the most recently modified session across formats", async () => {
		const sessions = [
			session("legacy", "C:/sessions/legacy.jsonl", 2),
			session("greenfield-old", "C:/sessions/old.conversation.jsonl", 1),
			session("greenfield-new", "C:/sessions/new.conversation.jsonl", 3),
		];
		const listSessions = vi.fn(async () => sessions);

		await expect(
			resolveImSessionPath({
				continueSession: true,
				cwd: "C:/workspace",
				sessionDir: "C:/sessions",
				sessionCatalog: createSessionCatalog(listSessions),
			}),
		).resolves.toBe("C:/sessions/new.conversation.jsonl");
		expect(listSessions).toHaveBeenCalledWith("C:/workspace", "C:/sessions");
	});

	it("returns no path when continue has no existing session", async () => {
		await expect(
			resolveImSessionPath({
				continueSession: true,
				cwd: "C:/workspace",
				sessionDir: "C:/sessions",
				sessionCatalog: createSessionCatalog(async () => []),
			}),
		).resolves.toBeUndefined();
	});
});

function session(id: string, path: string, modifiedAt: number): SessionHistoryInfo {
	return {
		id,
		path,
		cwd: "C:/workspace",
		firstMessage: id,
		modifiedAt,
	};
}

function createSessionCatalog(listSessions: RuntimeSessionCatalog["listSessions"]): RuntimeSessionCatalog {
	return {
		ownsSession: async () => false,
		listProjects: async () => [],
		listSessions,
		renameSession: async () => {},
		deleteSessionArtifacts: async () => {},
	};
}
