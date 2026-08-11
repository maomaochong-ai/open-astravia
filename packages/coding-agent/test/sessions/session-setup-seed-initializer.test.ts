import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileConversationRepository } from "@vetta/runtime-storage/conversation";
import { afterEach, describe, expect, it } from "vitest";
import { initializeCodingAgentSessionSetupSeed } from "../../src/sessions/setup/session-setup-seed-initializer.js";

describe("Coding Agent Session setup seed initializer", () => {
	const temporaryDirectories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("preserves setup views and publishes the complete native document graph", async () => {
		const targetRootDir = await temporaryDirectory(temporaryDirectories);
		let targetPath: string | undefined;
		await initializeCodingAgentSessionSetupSeed({
			cwd: "C:\\workspace",
			parentSession: "C:\\sessions\\parent.conversation.jsonl",
			targetRootDir,
			targetSessionId: "setup-seed",
			setup: async (writer) => {
				expect(writer.getSessionId()).toBe("setup-seed");
				expect(writer.getSessionDir()).toBe(targetRootDir);
				const sessionFile = writer.getSessionFile();
				if (!sessionFile) throw new Error("Expected setup to expose the target Session path");
				targetPath = sessionFile;

				const promptId = writer.appendMessage({ role: "user", content: "seed prompt", timestamp: 1 });
				expect(await readFile(sessionFile, "utf8")).toContain("seed prompt");
				writer.appendLabelChange(promptId, "prompt");
				writer.branch(promptId);
				writer.appendMessage({
					role: "bashExecution",
					command: "echo seed",
					output: "seed",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					timestamp: 2,
				});
				writer.branchWithSummary(promptId, "branch summary");
				writer.appendSessionInfo("  seeded session  ");

				expect(writer.getLabel(promptId)).toBe("prompt");
				expect(writer.getSessionName()).toBe("seeded session");
				expect(writer.getTree()).toHaveLength(1);
			},
		});

		if (!targetPath) throw new Error("Expected setup to expose the target Session path");
		const repository = new FileConversationRepository({ rootDir: targetRootDir });
		const document = await repository.readDocument("setup-seed");
		expect(document.identity).toMatchObject({
			sessionId: "setup-seed",
			cwd: "C:\\workspace",
			parentSessionPath: "C:\\sessions\\parent.conversation.jsonl",
		});
		expect(document.name).toBe("seeded session");
		expect(document.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "message", message: expect.objectContaining({ role: "user" }) }),
				expect.objectContaining({ type: "label", label: "prompt" }),
				expect.objectContaining({
					type: "custom_message",
					customType: "vetta.legacy_agent_message",
					modelVisible: true,
				}),
				expect.objectContaining({ type: "branch_summary", summary: "branch summary" }),
				expect.objectContaining({ type: "session_info", name: "seeded session" }),
			]),
		);
		const content = await readFile(targetPath, "utf8");
		expect(content).toContain('"recordType":"conversation.seed"');
		expect(content).not.toContain("coding-agent-jsonl");
	});
});

async function temporaryDirectory(collection: string[]): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "coding-agent-session-setup-seed-"));
	collection.push(directory);
	return directory;
}
