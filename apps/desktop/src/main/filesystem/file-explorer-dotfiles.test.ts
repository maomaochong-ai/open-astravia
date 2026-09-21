import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	allowProjectRoot,
	createFilesystemEntry,
	readFilesystemDirectory,
	renameFilesystemPath,
} from "./filesystem-service";

let directory: string;
afterEach(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

describe("file explorer dotfiles", () => {
	it("lists dotfiles and folders, including after create and rename, without reading their contents", async () => {
		directory = await mkdtemp(join(tmpdir(), "vetta-explorer-dotfiles-"));
		allowProjectRoot(directory);
		await mkdir(join(directory, ".github"));
		await writeFile(join(directory, ".env"), "fixture-only");
		await writeFile(join(directory, "desktop.ini"), "fixture");
		expect((await readFilesystemDirectory(directory)).map((entry) => entry.name)).toEqual([
			".github",
			".env",
			"desktop.ini",
		]);
		await createFilesystemEntry(directory, ".gitignore", "file");
		await renameFilesystemPath(join(directory, ".env"), join(directory, ".env.local"));
		const entries = await readFilesystemDirectory(directory);
		expect(entries.map((entry) => entry.name)).toContain(".gitignore");
		expect(entries.map((entry) => entry.name)).toContain(".env.local");
		expect(entries.map((entry) => entry.name)).not.toContain(".env");
	});
});
