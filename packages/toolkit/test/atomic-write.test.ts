import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each test decides how many renames the platform refuses before letting one through.
const refusals = vi.hoisted(() => ({ sync: [] as string[], async: [] as string[] }));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		renameSync: (from: string, to: string) => {
			const code = refusals.sync.shift();
			if (code) throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
			actual.renameSync(from, to);
		},
	};
});

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		rename: async (from: string, to: string) => {
			const code = refusals.async.shift();
			if (code) throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
			await actual.rename(from, to);
		},
	};
});

const { atomicWriteFile, atomicWriteFileAsync } = await import("../src/atomic-write.js");

const directories: string[] = [];

afterEach(async () => {
	refusals.sync.length = 0;
	refusals.async.length = 0;
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "vetta-atomic-write-"));
	directories.push(directory);
	return directory;
}

describe("atomicWriteFile", () => {
	it("tries again when Windows briefly holds the target file", async () => {
		const directory = await createDirectory();
		const path = join(directory, "config.json");
		refusals.sync.push("EPERM", "EBUSY");

		atomicWriteFile(path, "{}");

		expect(await readFile(path, "utf8")).toBe("{}");
		expect(await readdir(directory)).toEqual(["config.json"]);
	});

	it("gives up on errors that waiting cannot fix and leaves no temp file", async () => {
		const directory = await createDirectory();
		const path = join(directory, "config.json");
		refusals.sync.push("ENOSPC");

		expect(() => atomicWriteFile(path, "{}")).toThrow("ENOSPC");
		expect(await readdir(directory)).toEqual([]);
	});

	it("gives up after a hold that does not pass", async () => {
		const directory = await createDirectory();
		const path = join(directory, "config.json");
		refusals.sync.push(...Array.from({ length: 10 }, () => "EPERM"));

		expect(() => atomicWriteFile(path, "{}")).toThrow("EPERM");
		expect(await readdir(directory)).toEqual([]);
	});
});

describe("atomicWriteFileAsync", () => {
	it("tries again when Windows briefly holds the target file", async () => {
		const directory = await createDirectory();
		const path = join(directory, "config.json");
		refusals.async.push("EACCES");

		await atomicWriteFileAsync(path, "{}");

		expect(await readFile(path, "utf8")).toBe("{}");
	});

	it("lets concurrent writes to one file each finish", async () => {
		const directory = await createDirectory();
		const path = join(directory, "config.json");

		await Promise.all(Array.from({ length: 5 }, (_, index) => atomicWriteFileAsync(path, `{"n":${index}}`)));

		expect(JSON.parse(await readFile(path, "utf8")).n).toBeTypeOf("number");
		expect(await readdir(directory)).toEqual(["config.json"]);
	});

	it("keeps retrying without blocking the event loop during a longer Windows hold", async () => {
		const directory = await createDirectory();
		const path = join(directory, "config.json");
		refusals.async.push(...Array.from({ length: 11 }, () => "EPERM"));
		let timerRan = false;
		const timer = new Promise<void>((resolve) => {
			setTimeout(() => {
				timerRan = true;
				resolve();
			}, 0);
		});

		const write = atomicWriteFileAsync(path, "{}");
		await timer;

		expect(timerRan).toBe(true);
		await expect(write).resolves.toBeUndefined();
		expect(await readFile(path, "utf8")).toBe("{}");
	});
});
