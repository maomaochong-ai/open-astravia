import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileConversationRepository } from "@vetta/runtime-node/conversation";
import { afterEach, describe, expect, it } from "vitest";
import { readTeamConversationDocument } from "./team-session-file-reader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("readTeamConversationDocument", () => {
	it("reads a coordination document without a Runtime host", async () => {
		const directory = await mkdtemp(join(tmpdir(), "vetta-team-bootstrap-"));
		temporaryDirectories.push(directory);
		const repository = new FileConversationRepository({ rootDir: directory });
		await repository.create({ sessionId: "team-session", createdAt: 1 });
		await repository.execute("team-session", null, {
			type: "custom.append",
			entryId: "state",
			customType: "agent-team.session-state.v1",
			data: { ready: true },
			timestamp: new Date(1).toISOString(),
		});
		const path = repository.resolveConversationPath("team-session");
		await repository.close();

		const document = await readTeamConversationDocument("team-session", path);
		expect(document.entries).toHaveLength(1);
		expect(document.entries.at(-1)).toMatchObject({ type: "custom", customType: "agent-team.session-state.v1" });
	});

	it("rejects a path whose encoded id does not match", async () => {
		await expect(readTeamConversationDocument("team-session", "C:/runtime/other.conversation.jsonl")).rejects.toThrow(
			"path does not match",
		);
	});
});
