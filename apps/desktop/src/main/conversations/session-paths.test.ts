import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONVERSATION_CWD } from "../config/desktop-config-store.js";
import { isConversationWorkspaceDirEntry, readDesktopSessionHeader } from "./session-paths.js";

describe("readDesktopSessionHeader", () => {
	const directories: string[] = [];

	afterEach(async () => {
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("reads both historical and native cwd headers", async () => {
		const directory = await temporaryDirectory("desktop-session-header-");
		const cwd = join(directory, "workspace");
		const legacyPath = join(directory, "legacy.jsonl");
		const nativePath = join(directory, "native.conversation.jsonl");
		await writeFile(legacyPath, `${JSON.stringify({ type: "session", cwd })}\n`, "utf8");
		await writeFile(
			nativePath,
			`${JSON.stringify({
				recordType: "conversation.header",
				schemaVersion: 2,
				sessionId: "native-session",
				createdAt: Date.now(),
				cwd,
			})}\n`,
			"utf8",
		);

		await expect(readDesktopSessionHeader(legacyPath)).resolves.toEqual({ type: "session", cwd });
		await expect(readDesktopSessionHeader(nativePath)).resolves.toEqual({ type: "session", cwd });
	});

	it("rejects unsupported or relative cwd headers", async () => {
		const directory = await temporaryDirectory("desktop-invalid-session-header-");
		const unsupportedPath = join(directory, "unsupported.jsonl");
		const relativePath = join(directory, "relative.conversation.jsonl");
		await writeFile(unsupportedPath, `${JSON.stringify({ recordType: "other", cwd: directory })}\n`, "utf8");
		await writeFile(
			relativePath,
			`${JSON.stringify({
				recordType: "conversation.header",
				schemaVersion: 2,
				sessionId: "relative-session",
				createdAt: Date.now(),
				cwd: "relative",
			})}\n`,
			"utf8",
		);

		await expect(readDesktopSessionHeader(unsupportedPath)).resolves.toBeUndefined();
		await expect(readDesktopSessionHeader(relativePath)).resolves.toBeUndefined();
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

describe("isConversationWorkspaceDirEntry", () => {
	const uuidName = "0c558d85-6603-4e52-81a4-ba686d57a3e4";

	it("识别「对话」根下 uuid 命名的会话工作区目录（大小写不敏感）", () => {
		expect(isConversationWorkspaceDirEntry(DEFAULT_CONVERSATION_CWD, uuidName)).toBe(true);
		expect(isConversationWorkspaceDirEntry(DEFAULT_CONVERSATION_CWD, uuidName.toUpperCase())).toBe(true);
	});

	it("「对话」根下的老产物目录（非 uuid 命名）不受影响", () => {
		expect(isConversationWorkspaceDirEntry(DEFAULT_CONVERSATION_CWD, "报告素材")).toBe(false);
		expect(isConversationWorkspaceDirEntry(DEFAULT_CONVERSATION_CWD, "report.html")).toBe(false);
		expect(isConversationWorkspaceDirEntry(DEFAULT_CONVERSATION_CWD, `${uuidName}-extra`)).toBe(false);
	});

	it("只作用于「对话」根这一层：其它目录与工作区内部的 uuid 目录都不匹配", () => {
		expect(isConversationWorkspaceDirEntry("/tmp/some-project", uuidName)).toBe(false);
		expect(isConversationWorkspaceDirEntry(join(DEFAULT_CONVERSATION_CWD, uuidName), uuidName)).toBe(false);
	});
});
