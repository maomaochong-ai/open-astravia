import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowProjectRoot, readFilesystemDirectory } from "./filesystem-service";

let directory: string;
afterEach(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

describe("readFilesystemDirectory", () => {
	it("returns every entry with its metadata, directories first, then by name", async () => {
		directory = await mkdtemp(join(tmpdir(), "astravia-read-dir-"));
		allowProjectRoot(directory);
		await mkdir(join(directory, "zeta"));
		await mkdir(join(directory, "Alpha"));
		await writeFile(join(directory, "b.txt"), "12345");
		await writeFile(join(directory, "a.txt"), "1");

		const entries = await readFilesystemDirectory(directory);

		expect(entries.map((entry) => entry.name)).toEqual(["Alpha", "zeta", "a.txt", "b.txt"]);
		const a = entries.find((entry) => entry.name === "a.txt");
		const b = entries.find((entry) => entry.name === "b.txt");
		expect(a?.isDirectory).toBe(false);
		expect(a?.size).toBe(1);
		expect(b?.size).toBe(5);
		expect(a?.path).toBe(join(directory, "a.txt"));
		expect(typeof a?.modifiedAt).toBe("number");
	});

	it("skips entries whose stat fails instead of failing the whole listing", async () => {
		directory = await mkdtemp(join(tmpdir(), "astravia-read-dir-"));
		allowProjectRoot(directory);
		await writeFile(join(directory, "kept.txt"), "kept");
		await symlink(join(directory, "missing-target"), join(directory, "dangling"));

		const entries = await readFilesystemDirectory(directory);

		expect(entries.map((entry) => entry.name)).toEqual(["kept.txt"]);
	});

	it("keeps metadata correct across many entries", async () => {
		directory = await mkdtemp(join(tmpdir(), "astravia-read-dir-"));
		allowProjectRoot(directory);
		const names = Array.from({ length: 120 }, (_, index) => `file-${String(index).padStart(3, "0")}.txt`);
		await Promise.all(names.map((name) => writeFile(join(directory, name), name)));

		const entries = await readFilesystemDirectory(directory);

		expect(entries).toHaveLength(names.length);
		expect(entries.map((entry) => entry.name)).toEqual(names);
		expect(entries.every((entry) => entry.size === entry.name.length)).toBe(true);
	});
});
