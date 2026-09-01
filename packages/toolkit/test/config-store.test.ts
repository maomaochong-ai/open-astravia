import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVersionedJsonConfigStore } from "../src/config-store.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createPath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "vetta-config-store-"));
	directories.push(directory);
	return join(directory, "config.json");
}

describe("VersionedJsonConfigStore read error policy", () => {
	it("uses defaults for a missing file even in strict mode", async () => {
		const path = await createPath();
		const store = createVersionedJsonConfigStore({
			path,
			name: "strict-config",
			readErrorPolicy: "throw",
			normalize: (value) => (typeof value === "object" && value ? value : { revision: 0 }),
		});
		await expect(store.read()).resolves.toEqual({ revision: 0 });
	});

	it("preserves and reports an invalid existing file in strict mode", async () => {
		const path = await createPath();
		await writeFile(path, "{invalid", "utf8");
		const warn = vi.fn();
		const store = createVersionedJsonConfigStore({
			path,
			name: "strict-config",
			readErrorPolicy: "throw",
			normalize: (value) => value,
			logger: { warn },
		});
		await expect(store.read()).rejects.toBeInstanceOf(SyntaxError);
		expect(warn).toHaveBeenCalledWith("config read failed", { name: "strict-config", path }, expect.any(SyntaxError));
	});
});
