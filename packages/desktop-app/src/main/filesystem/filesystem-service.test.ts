import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FILE_EXPLORER_ENTRY_EXISTS_ERROR } from "../../preload/file-explorer-entry-name";
import { FS_EDITABLE_TEXT_ERROR } from "../../preload/fs-types";
import {
	allowProjectRoot,
	createFilesystemEntry,
	readEditableTextFile,
	saveEditableTextFile,
} from "./filesystem-service";

describe("createFilesystemEntry", () => {
	let projectRoot = "";

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(tmpdir(), "vetta-create-entry-"));
		allowProjectRoot(projectRoot);
	});

	afterEach(async () => {
		if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
	});

	it("creates an empty file and returns its metadata", async () => {
		const entry = await createFilesystemEntry(projectRoot, "notes.md", "file");

		expect(entry).toMatchObject({ name: "notes.md", isDirectory: false, size: 0 });
		expect((await stat(entry.path)).isFile()).toBe(true);
	});

	it("creates a directory", async () => {
		const entry = await createFilesystemEntry(projectRoot, "docs", "directory");

		expect(entry).toMatchObject({ name: "docs", isDirectory: true });
		expect((await stat(entry.path)).isDirectory()).toBe(true);
	});

	it("never overwrites an existing file", async () => {
		const filePath = join(projectRoot, "keep.txt");
		await writeFile(filePath, "keep this", "utf8");

		await expect(createFilesystemEntry(projectRoot, "keep.txt", "file")).rejects.toThrow(
			FILE_EXPLORER_ENTRY_EXISTS_ERROR,
		);
		expect(await readFile(filePath, "utf8")).toBe("keep this");
	});

	it("rejects names that escape the parent directory", async () => {
		await expect(createFilesystemEntry(projectRoot, "../outside.txt", "file")).rejects.toThrow(
			"FILE_EXPLORER_INVALID_ENTRY_NAME:path-separator",
		);
	});
});

describe("editable text files", () => {
	let projectRoot = "";

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(tmpdir(), "vetta-editable-text-"));
		allowProjectRoot(projectRoot);
	});

	afterEach(async () => {
		if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
	});

	it("preserves BOM and CRLF while saving", async () => {
		const filePath = join(projectRoot, "notes.txt");
		await writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("one\r\ntwo\r\n")]));

		const snapshot = await readEditableTextFile(filePath);
		expect(snapshot).toMatchObject({
			content: "one\r\ntwo\r\n",
			hasBom: true,
			lineEnding: "crlf",
		});

		const result = await saveEditableTextFile(filePath, "one\r\ntwo updated\r\n", {
			expectedRevision: snapshot.revision,
			hasBom: snapshot.hasBom,
		});

		expect(result.status).toBe("saved");
		const written = await readFile(filePath);
		expect(written.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
		expect(written.subarray(3).toString("utf8")).toBe("one\r\ntwo updated\r\n");
	});

	it("does not overwrite a file changed after it was read", async () => {
		const filePath = join(projectRoot, "notes.txt");
		await writeFile(filePath, "original", "utf8");
		const snapshot = await readEditableTextFile(filePath);
		await writeFile(filePath, "external change", "utf8");

		const result = await saveEditableTextFile(filePath, "editor change", {
			expectedRevision: snapshot.revision,
		});

		expect(result.status).toBe("conflict");
		expect(await readFile(filePath, "utf8")).toBe("external change");
	});

	it("allows an explicit force save after a conflict", async () => {
		const filePath = join(projectRoot, "notes.txt");
		await writeFile(filePath, "original", "utf8");
		const snapshot = await readEditableTextFile(filePath);
		await writeFile(filePath, "external change", "utf8");

		const result = await saveEditableTextFile(filePath, "editor change", {
			expectedRevision: snapshot.revision,
			force: true,
		});

		expect(result.status).toBe("saved");
		expect(await readFile(filePath, "utf8")).toBe("editor change");
	});

	it("rejects invalid UTF-8", async () => {
		const filePath = join(projectRoot, "binary.txt");
		await writeFile(filePath, Buffer.from([0xff, 0xfe, 0x00, 0x00]));

		await expect(readEditableTextFile(filePath)).rejects.toThrow(FS_EDITABLE_TEXT_ERROR.NOT_UTF8);
	});
});
