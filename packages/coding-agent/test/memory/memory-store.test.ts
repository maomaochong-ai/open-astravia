import { describe, expect, it } from "vitest";
import {
	applyMemoryDocumentOperation,
	MemoryDocumentStore,
	parseMemoryEntries,
	serializeMemoryEntries,
} from "../../src/memory/index.js";
import { createMemoryTextStorage, readMemoryTextStorage } from "../fixtures/memory-storage.js";

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

	it("keeps validation and character-budget failures non-mutating", () => {
		const storage = createMemoryTextStorage("existing");
		const store = new MemoryDocumentStore({ storage, charLimit: 10 });

		expect(() => store.apply("add", { content: "" })).toThrow(
			"memory add: `content` is required and must be non-empty",
		);
		expect(() => store.apply("replace", { match: "missing", content: "new" })).toThrow(
			'memory replace: no entry matching "missing"',
		);
		expect(() => store.apply("add", { content: "too long" })).toThrow("memory add: would exceed the 10-char limit");
		expect(readMemoryTextStorage(storage)).toBe("existing");
	});

	it("reads missing storage as empty and persists successful operations", () => {
		const storage = createMemoryTextStorage();
		const store = new MemoryDocumentStore({ storage });

		expect(store.readContent()).toBe("");
		expect(store.apply("add", { content: "Uses Bun" })).toEqual({
			entries: ["Uses Bun"],
			chars: 8,
			limit: 4_000,
		});
		expect(readMemoryTextStorage(storage)).toBe("Uses Bun");
	});
});
