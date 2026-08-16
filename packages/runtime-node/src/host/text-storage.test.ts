import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeScopedTextStorage } from "./scoped-text-storage.js";
import { NodeTransactionalTextStorage } from "./transactional-text-storage.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createTemporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "runtime-node-text-storage-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("Node scoped text storage", () => {
	it("isolates scope paths and exposes the latest external contents under lock", () => {
		const directory = createTemporaryDirectory();
		const globalPath = join(directory, "global", "settings.json");
		const projectPath = join(directory, "project", "settings.json");
		const storage = new NodeScopedTextStorage({ global: globalPath, project: projectPath });
		storage.withLock("global", () => "global-1");
		storage.withLock("project", () => "project-1");
		writeFileSync(globalPath, "external", "utf8");
		let current: string | undefined;
		storage.withLock("global", (value) => {
			current = value;
			return "merged";
		});
		expect(current).toBe("external");
		expect(readFileSync(globalPath, "utf8")).toBe("merged");
		expect(readFileSync(projectPath, "utf8")).toBe("project-1");
	});

	it("does not create a file for read-only operations", () => {
		const directory = createTemporaryDirectory();
		const path = join(directory, "missing", "settings.json");
		const storage = new NodeScopedTextStorage({ global: path });
		storage.withLock("global", (current) => {
			expect(current).toBeUndefined();
			return undefined;
		});
		expect(existsSync(path)).toBe(false);
	});
});

describe("Node transactional text storage", () => {
	it("creates secure storage and commits synchronous transactions", () => {
		const directory = createTemporaryDirectory();
		const path = join(directory, "credentials", "auth.json");
		const storage = new NodeTransactionalTextStorage(path);
		const result = storage.withLock((current) => ({ result: current, next: '{"key":"value"}' }));
		expect(result).toBe("{}");
		expect(readFileSync(path, "utf8")).toBe('{"key":"value"}');
		if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("serializes asynchronous transactions against the latest committed value", async () => {
		const directory = createTemporaryDirectory();
		const path = join(directory, "auth.json");
		const storage = new NodeTransactionalTextStorage(path);
		let releaseFirst: (() => void) | undefined;
		let firstEntered: (() => void) | undefined;
		const entered = new Promise<void>((resolve) => {
			firstEntered = resolve;
		});
		const hold = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const first = storage.withLockAsync(async () => {
			firstEntered?.();
			await hold;
			return { result: "first", next: "one" };
		});
		await entered;
		const second = storage.withLockAsync(async (current) => ({ result: current, next: "two" }));
		releaseFirst?.();
		await expect(first).resolves.toBe("first");
		await expect(second).resolves.toBe("one");
		expect(readFileSync(path, "utf8")).toBe("two");
	});
});
