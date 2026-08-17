import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishConversationFileExclusive } from "../../src/conversation/conversation-file-publisher.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("exclusive conversation file publisher", () => {
	it("publishes complete content without leaving a temporary file", async () => {
		const root = await createRoot();
		const target = join(root, "created.conversation.jsonl");

		await publishConversationFileExclusive(target, "header\nbody\n");

		expect(await readFile(target, "utf8")).toBe("header\nbody\n");
		expect(await readdir(root)).toEqual(["created.conversation.jsonl"]);
	});

	it("keeps an existing target unchanged and cleans the failed publication", async () => {
		const root = await createRoot();
		const target = join(root, "existing.conversation.jsonl");
		await writeFile(target, "existing\n", "utf8");

		await expect(publishConversationFileExclusive(target, "replacement\n")).rejects.toMatchObject({
			code: "EEXIST",
		});

		expect(await readFile(target, "utf8")).toBe("existing\n");
		expect(await readdir(root)).toEqual(["existing.conversation.jsonl"]);
	});

	it("does not create a target when writing the temporary file fails", async () => {
		const root = await createRoot();
		const missingDirectory = join(root, "missing");
		const target = join(missingDirectory, "failed.conversation.jsonl");

		await expect(publishConversationFileExclusive(target, "content\n")).rejects.toMatchObject({ code: "ENOENT" });

		expect(await readdir(root)).toEqual([]);
		await mkdir(missingDirectory, { recursive: true });
		expect(await readdir(missingDirectory)).toEqual([]);
	});
});

async function createRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-conversation-publisher-"));
	temporaryRoots.push(root);
	return root;
}
