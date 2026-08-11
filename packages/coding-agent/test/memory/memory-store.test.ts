import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyMemoryDocumentOperation,
	FileMemoryStore,
	parseMemoryEntries,
	serializeMemoryEntries,
} from "../../src/memory/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Memory document and file store", () => {
	it("preserves the MEMORY.md separator and first-match operation semantics", () => {
		const content = serializeMemoryEntries([" Uses Bun ", "Uses TypeScript", "Bun appears again"]);
		expect(content).toBe(" Uses Bun \n\n§\n\nUses TypeScript\n\n§\n\nBun appears again");
		expect(parseMemoryEntries(content)).toEqual(["Uses Bun", "Uses TypeScript", "Bun appears again"]);

		const replaced = applyMemoryDocumentOperation(content, "replace", {
			match: "Bun",
			content: "Uses Bun workspaces",
		});
		expect(replaced.state.entries).toEqual(["Uses Bun workspaces", "Uses TypeScript", "Bun appears again"]);
		const removed = applyMemoryDocumentOperation(replaced.content, "remove", { match: "Bun" });
		expect(removed.state.entries).toEqual(["Uses TypeScript", "Bun appears again"]);
	});

	it("keeps validation and character-budget failures non-mutating", async () => {
		const root = await temporaryRoot();
		const path = join(root, "MEMORY.md");
		await writeFile(path, "existing", "utf8");
		const store = new FileMemoryStore({ path, charLimit: 10 });

		expect(() => store.apply("add", { content: "" })).toThrow(
			"memory add: `content` is required and must be non-empty",
		);
		expect(() => store.apply("replace", { match: "missing", content: "new" })).toThrow(
			'memory replace: no entry matching "missing"',
		);
		expect(() => store.apply("add", { content: "too long" })).toThrow("memory add: would exceed the 10-char limit");
		expect(await readFile(path, "utf8")).toBe("existing");
	});

	it("reads a missing file as empty and persists successful operations atomically", async () => {
		const root = await temporaryRoot();
		const path = join(root, "MEMORY.md");
		const store = new FileMemoryStore({ path });

		expect(store.readContent()).toBe("");
		expect(store.apply("add", { content: "Uses Bun" })).toEqual({
			entries: ["Uses Bun"],
			chars: 8,
			limit: 4_000,
		});
		expect(await readFile(path, "utf8")).toBe("Uses Bun");
	});
});

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-memory-store-"));
	temporaryRoots.push(root);
	return root;
}
