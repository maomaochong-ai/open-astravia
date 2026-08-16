import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeResourceAccess } from "./resource-access.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

describe("Node resource access", () => {
	it("exposes asynchronous file metadata, text, directory and real-path operations", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "runtime-node-resource-access-"));
		temporaryDirectories.push(root);
		const directory = path.join(root, "resources");
		const file = path.join(directory, "SYSTEM.md");
		await mkdir(directory);
		await writeFile(file, "instructions", "utf8");
		const access = createNodeResourceAccess();

		await expect(access.files.stat(path.join(root, "missing"))).resolves.toBeUndefined();
		await expect(access.files.stat(file)).resolves.toMatchObject({ kind: "file", size: 12 });
		await expect(access.files.readText(file)).resolves.toBe("instructions");
		await expect(access.files.readDirectory(directory)).resolves.toEqual([
			{ name: "SYSTEM.md", kind: "file", symbolicLink: false },
		]);
		const canonicalPath = await access.files.realPath(file);
		expect(path.basename(canonicalPath)).toBe("SYSTEM.md");
		expect(path.basename(path.dirname(canonicalPath))).toBe("resources");
	});

	it("provides the host path semantics without exposing Node modules to consumers", () => {
		const access = createNodeResourceAccess();
		const joined = access.paths.join("workspace", "resources", "SKILL.md");
		expect(access.paths.basename(joined)).toBe("SKILL.md");
		expect(access.paths.dirname(joined)).toBe(access.paths.join("workspace", "resources"));
		expect(access.paths.resolve(joined)).toBe(path.resolve(joined));
		expect(access.paths.separator).toBe(path.sep);
		expect(access.paths.homeDirectory()).toBeTruthy();
	});

	it("rejects resource work when the caller has already cancelled", async () => {
		const controller = new AbortController();
		controller.abort();
		const access = createNodeResourceAccess();

		await expect(access.files.stat("unused", { signal: controller.signal })).rejects.toMatchObject({
			name: "AbortError",
		});
	});
});
