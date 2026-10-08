import { describe, expect, it } from "vitest";
import {
	applyMemoryDocumentOperation,
	MemoryDocumentStore,
	parseMemoryEntries,
	ScopedMemoryStore,
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

	it("routes writes to the requested scope and reports where they landed", () => {
		const projectStorage = createMemoryTextStorage("Project fact");
		const userStorage = createMemoryTextStorage();
		const store = new ScopedMemoryStore({
			defaultScope: "user",
			bindings: [
				{ scope: "user", file: "/agent/MEMORY.md", store: new MemoryDocumentStore({ storage: userStorage }) },
				{
					scope: "project",
					file: "/workspace/MEMORY.md",
					store: new MemoryDocumentStore({ storage: projectStorage }),
				},
			],
		});

		expect(store.apply("add", { content: "Prefers Bun" })).toEqual({
			entries: ["Prefers Bun"],
			chars: 11,
			limit: 4_000,
			scope: "user",
			file: "/agent/MEMORY.md",
		});
		expect(readMemoryTextStorage(userStorage)).toBe("Prefers Bun");
		expect(readMemoryTextStorage(projectStorage)).toBe("Project fact");

		expect(store.apply("add", { content: "Uses TypeScript", scope: "project" })).toMatchObject({
			scope: "project",
			file: "/workspace/MEMORY.md",
			entries: ["Project fact", "Uses TypeScript"],
		});
		expect(readMemoryTextStorage(projectStorage)).toBe("Project fact\n\n§\n\nUses TypeScript");
	});

	it("rejects a scope this session does not bind", () => {
		const store = new ScopedMemoryStore({
			defaultScope: "project",
			bindings: [
				{
					scope: "project",
					file: "/workspace/MEMORY.md",
					store: new MemoryDocumentStore({ storage: createMemoryTextStorage() }),
				},
			],
		});

		expect(() => store.apply("add", { content: "x", scope: "user" })).toThrow(
			'memory add: the "user" scope is not available in this session (available: "project").',
		);
	});
});
