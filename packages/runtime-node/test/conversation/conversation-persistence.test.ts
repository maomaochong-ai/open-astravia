import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createFileConversationPersistence,
	createInMemoryConversationPersistence,
} from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Runtime Node conversation persistence", () => {
	it("binds all file persistence ports to one repository and exposes a resumable path", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "runtime-node-conversation-persistence-"));
		temporaryRoots.push(rootDir);
		const persistence = createFileConversationPersistence(rootDir);

		expect(persistence.documentStore).toBe(persistence.repository);
		expect(persistence.continuationStore).toBe(persistence.repository);
		expect(persistence.resolveSessionDirectory("session")).toBe(rootDir);
		expect(persistence.resolveSessionPath("session")).toBe(persistence.resolveConversationPath("session"));
		const sessionPath = persistence.resolveConversationPath("session");
		await writeFile(sessionPath, "", "utf8");
		expect(await persistence.assessSessionPath("session", sessionPath)).toBe("valid");
		expect(await persistence.assessSessionPath("session", join(rootDir, "other.conversation.jsonl"))).toBe(
			"path-mismatch",
		);
		expect(await persistence.assessSessionPath("missing", persistence.resolveConversationPath("missing"))).toBe(
			"missing",
		);
		const directoryPath = persistence.resolveConversationPath("directory");
		await mkdir(directoryPath);
		expect(await persistence.assessSessionPath("directory", directoryPath)).toBe("not-file");

		await persistence.dispose();
	});

	it("keeps in-memory identities non-resumable", async () => {
		const persistence = createInMemoryConversationPersistence();

		expect(persistence.resolveConversationPath("session")).toBe("memory://conversation/session");
		expect(persistence.resolveSessionDirectory("session")).toBeUndefined();
		expect(persistence.resolveSessionPath("session")).toBeUndefined();
		expect(await persistence.assessSessionPath("session", "memory://conversation/session")).toBe("path-mismatch");

		await persistence.dispose();
	});
});
