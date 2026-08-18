import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectFilesystemTransfer, transferFilesystemEntries } from "./file-transfer-service";
import { allowProjectRoot } from "./filesystem-service";

let testRoot: string;
let projectDirectory: string;
let sourceDirectory: string;

beforeEach(async () => {
	testRoot = await mkdtemp(join(tmpdir(), "vetta-file-transfer-test-"));
	projectDirectory = join(testRoot, "project");
	sourceDirectory = join(testRoot, "external");
	await Promise.all([mkdir(projectDirectory, { recursive: true }), mkdir(sourceDirectory, { recursive: true })]);
	allowProjectRoot(projectDirectory);
});

afterEach(async () => {
	await rm(testRoot, { recursive: true, force: true });
});

describe("file transfer service", () => {
	it("copies a nested directory without removing the source", async () => {
		const source = join(sourceDirectory, "assets");
		await mkdir(join(source, "icons"), { recursive: true });
		await writeFile(join(source, "icons", "app.txt"), "icon", "utf8");

		const result = await transferFilesystemEntries({
			sourcePaths: [source],
			destinationDirectory: projectDirectory,
			action: "copy",
			conflictPolicy: "keep-both",
		});

		expect(result.items).toEqual([expect.objectContaining({ name: "assets", status: "copied" })]);
		expect(await readFile(join(projectDirectory, "assets", "icons", "app.txt"), "utf8")).toBe("icon");
		expect(existsSync(source)).toBe(true);
	});

	it("moves a nested directory and removes the source after completion", async () => {
		const source = join(sourceDirectory, "docs");
		await mkdir(join(source, "nested"), { recursive: true });
		await writeFile(join(source, "nested", "readme.txt"), "content", "utf8");

		const result = await transferFilesystemEntries({
			sourcePaths: [source],
			destinationDirectory: projectDirectory,
			action: "move",
			conflictPolicy: "keep-both",
		});

		expect(result.items[0]?.status).toBe("moved");
		expect(await readFile(join(projectDirectory, "docs", "nested", "readme.txt"), "utf8")).toBe("content");
		expect(existsSync(source)).toBe(false);
	});

	it("keeps both files by assigning a deterministic suffix", async () => {
		const source = join(sourceDirectory, "report.txt");
		await writeFile(source, "new", "utf8");
		await writeFile(join(projectDirectory, "report.txt"), "old", "utf8");

		const result = await transferFilesystemEntries({
			sourcePaths: [source],
			destinationDirectory: projectDirectory,
			action: "copy",
			conflictPolicy: "keep-both",
		});

		expect(result.items[0]).toEqual(
			expect.objectContaining({ status: "copied", destinationPath: join(projectDirectory, "report (1).txt") }),
		);
		expect(await readFile(join(projectDirectory, "report.txt"), "utf8")).toBe("old");
		expect(await readFile(join(projectDirectory, "report (1).txt"), "utf8")).toBe("new");
	});

	it("replaces or skips an existing destination according to policy", async () => {
		const source = join(sourceDirectory, "state.txt");
		const destination = join(projectDirectory, "state.txt");
		await writeFile(source, "new", "utf8");
		await writeFile(destination, "old", "utf8");

		const skipped = await transferFilesystemEntries({
			sourcePaths: [source],
			destinationDirectory: projectDirectory,
			action: "copy",
			conflictPolicy: "skip",
		});
		expect(skipped.items[0]?.status).toBe("skipped");
		expect(await readFile(destination, "utf8")).toBe("old");

		const replaced = await transferFilesystemEntries({
			sourcePaths: [source],
			destinationDirectory: projectDirectory,
			action: "copy",
			conflictPolicy: "replace",
		});
		expect(replaced.items[0]?.status).toBe("copied");
		expect(await readFile(destination, "utf8")).toBe("new");
	});

	it("reports conflicts during inspection and rejects destinations outside project roots", async () => {
		const source = join(sourceDirectory, "data.txt");
		await writeFile(source, "data", "utf8");
		await writeFile(join(projectDirectory, "data.txt"), "existing", "utf8");

		await expect(inspectFilesystemTransfer([source], projectDirectory)).resolves.toEqual([
			{ name: "data.txt", isDirectory: false, hasConflict: true },
		]);
		await expect(inspectFilesystemTransfer([source], sourceDirectory)).rejects.toThrow(
			"outside any known project directory",
		);
	});

	it("duplicates a file when copying into the same parent directory", async () => {
		const source = join(projectDirectory, "note.txt");
		await writeFile(source, "body", "utf8");

		const result = await transferFilesystemEntries({
			sourcePaths: [source],
			destinationDirectory: projectDirectory,
			action: "copy",
			conflictPolicy: "keep-both",
		});

		expect(result.items[0]).toEqual(
			expect.objectContaining({ status: "copied", destinationPath: join(projectDirectory, "note (1).txt") }),
		);
		expect(await readFile(source, "utf8")).toBe("body");
		expect(await readFile(join(projectDirectory, "note (1).txt"), "utf8")).toBe("body");
	});

	it("skips move when the source already lives in the destination directory", async () => {
		const source = join(projectDirectory, "stay.txt");
		await writeFile(source, "stay", "utf8");

		const result = await transferFilesystemEntries({
			sourcePaths: [source],
			destinationDirectory: projectDirectory,
			action: "move",
			conflictPolicy: "keep-both",
		});

		expect(result.items[0]?.status).toBe("skipped");
		expect(existsSync(source)).toBe(true);
	});
});
