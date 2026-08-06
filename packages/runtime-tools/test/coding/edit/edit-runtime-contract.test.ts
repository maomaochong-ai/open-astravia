import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createEditTool,
	createEditToolRegistration,
	EDIT_TOOL_CATEGORY,
	EDIT_TOOL_DESCRIPTION,
	EDIT_TOOL_SCOPES,
	type EditOperations,
	type EditPathPolicy,
	type EditToolInput,
	EditToolInputSchema,
	selectCodingToolsForScope,
} from "../../../src/coding/index.js";
import { anchorLineHash } from "../../../src/coding/shared/anchors.js";
import { createTestEditPathPolicy } from "../../support/path-policy.js";

const temporaryDirectories: string[] = [];
const permissivePathPolicy: EditPathPolicy = {
	getRejectionReason: () => undefined,
};

afterEach(() => {
	for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
	temporaryDirectories.length = 0;
});

function createTemporaryDirectory(label: string): string {
	const directory = mkdtempSync(join(tmpdir(), `vetta-runtime-edit-${label}-`));
	temporaryDirectories.push(directory);
	return directory;
}

function runtimeRequest(input: EditToolInput, signal = new AbortController().signal) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "runtime-edit",
		input,
		signal,
	};
}

function anchor(line: string, lineNumber: number): string {
	return `${lineNumber}:${anchorLineHash(line)}`;
}

async function errorMessage(operation: Promise<unknown>): Promise<string> {
	try {
		await operation;
		throw new Error("expected operation to reject");
	} catch (error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}
}

async function compareExactEdit(options: {
	readonly label: string;
	readonly initial: string;
	readonly oldText: string;
	readonly newText: string;
	readonly expected: string;
}): Promise<void> {
	const runtimeDirectory = createTemporaryDirectory(options.label);
	writeFileSync(join(runtimeDirectory, "file.txt"), options.initial);
	const input = { path: "file.txt", oldText: options.oldText, newText: options.newText };
	const runtimeResult = await createEditTool(runtimeDirectory, { pathPolicy: permissivePathPolicy }).execute(
		runtimeRequest(input),
	);
	expect(runtimeResult.content[0]).toMatchObject({ text: "Successfully replaced text in file.txt." });
	expect(readFileSync(join(runtimeDirectory, "file.txt"), "utf-8")).toBe(options.expected);
}

describe("runtime edit tool", () => {
	it("keeps the public definition, registration metadata, and full default scope", () => {
		const runtime = createEditToolRegistration(process.cwd(), { pathPolicy: permissivePathPolicy });
		expect(runtime.tool).toMatchObject({
			name: "edit",
			label: "edit",
			description: EDIT_TOOL_DESCRIPTION,
			inputSchema: EditToolInputSchema,
		});
		expect(runtime.scopeUse).toEqual(EDIT_TOOL_SCOPES);
		expect(runtime.category).toBe(EDIT_TOOL_CATEGORY);
		for (const scope of EDIT_TOOL_SCOPES) {
			expect(selectCodingToolsForScope([runtime], scope)).toEqual([runtime.tool]);
		}
	});

	it.each([
		{
			label: "exact",
			initial: "first\nsecond\nthird\n",
			oldText: "second\n",
			newText: "changed\n",
			expected: "first\nchanged\nthird\n",
		},
		{
			label: "fuzzy-whitespace",
			initial: "first   \nsecond  \nthird\n",
			oldText: "first\nsecond\n",
			newText: "changed\n",
			expected: "changed\nthird\n",
		},
		{
			label: "unicode-normalization",
			initial: "const value = ‘one—two’;\n",
			oldText: "const value = 'one-two';",
			newText: "const value = 'changed';",
			expected: "const value = 'changed';\n",
		},
		{
			label: "crlf-bom",
			initial: "\uFEFFfirst\r\nsecond\r\nthird\r\n",
			oldText: "second\n",
			newText: "changed\n",
			expected: "\uFEFFfirst\r\nchanged\r\nthird\r\n",
		},
	])("preserves exact-text behavior for $label", compareExactEdit);

	it.each([
		{
			label: "missing text",
			initial: "alpha\n",
			oldText: "missing",
			newText: "changed",
		},
		{
			label: "duplicate text",
			initial: "same   \nsame\n",
			oldText: "same",
			newText: "changed",
		},
		{
			label: "identical replacement",
			initial: "same\n",
			oldText: "same",
			newText: "same",
		},
	])("preserves exact-text rejection for $label", async ({ label, initial, oldText, newText }) => {
		const runtimeDirectory = createTemporaryDirectory(`error-${label}`);
		writeFileSync(join(runtimeDirectory, "file.txt"), initial);
		const input = { path: "file.txt", oldText, newText };
		const runtimeError = await errorMessage(
			createEditTool(runtimeDirectory, { pathPolicy: permissivePathPolicy }).execute(runtimeRequest(input)),
		);
		expect(runtimeError).toMatch(
			label === "missing text"
				? /Could not find the exact text/
				: label === "duplicate text"
					? /Found 2 occurrences/
					: /No changes made/,
		);
		expect(readFileSync(join(runtimeDirectory, "file.txt"), "utf-8")).toBe(initial);
	});

	it("preserves atomic multi-anchor replacement, insertion, receipts, and diff details", async () => {
		const initial = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"].join("\n");
		const runtimeDirectory = createTemporaryDirectory("anchor-batch");
		writeFileSync(join(runtimeDirectory, "file.ts"), initial);
		const input = {
			path: "file.ts",
			edits: [
				{ anchor: anchor("const a = 1;", 1), new_text: "const a = 10;\nconst added = 11;" },
				{ anchor: anchor("const c = 3;", 3), new_text: "const afterC = 30;", insert_after: true },
			],
		};
		const runtimeResult = await createEditTool(runtimeDirectory, { pathPolicy: permissivePathPolicy }).execute(
			runtimeRequest(input),
		);
		expect(runtimeResult.details).toMatchObject({ appliedEdits: 2 });
		expect(readFileSync(join(runtimeDirectory, "file.ts"), "utf-8")).toBe(
			[
				"const a = 10;",
				"const added = 11;",
				"const b = 2;",
				"const c = 3;",
				"const afterC = 30;",
				"const d = 4;",
			].join("\n"),
		);
	});

	it("preserves shifted and unique bare-hash anchor recovery", async () => {
		const runtimeDirectory = createTemporaryDirectory("anchor-recovery");
		const initial = ["a", "b", "c", "d"].join("\n");
		writeFileSync(join(runtimeDirectory, "file.txt"), initial);
		const input = {
			path: "file.txt",
			edits: [
				{ anchor: anchor("c", 1), new_text: "C" },
				{ anchor: anchorLineHash("d"), new_text: "D" },
			],
		};
		const runtimeResult = await createEditTool(runtimeDirectory, { pathPolicy: permissivePathPolicy }).execute(
			runtimeRequest(input),
		);
		expect(runtimeResult.content[0]).toMatchObject({ text: expect.stringContaining("Applied 2 anchor edit(s)") });
		expect(readFileSync(join(runtimeDirectory, "file.txt"), "utf-8")).toBe("a\nb\nC\nD");
	});

	it.each([
		{
			label: "stale atomic batch",
			initial: ["const a = 1;", "const b = 2;", "const c = 3;"].join("\n"),
			input: {
				path: "file.ts",
				edits: [
					{ anchor: anchor("const a = 1;", 1), new_text: "const a = 10;" },
					{ anchor: "3:zz", new_text: "const c = 30;" },
				],
			},
		},
		{
			label: "overlapping ranges",
			initial: ["const a = 1;", "const b = 2;", "const c = 3;"].join("\n"),
			input: {
				path: "file.ts",
				edits: [
					{ anchor: anchor("const a = 1;", 1), end_anchor: anchor("const c = 3;", 3), new_text: "x" },
					{ anchor: anchor("const b = 2;", 2), new_text: "y" },
				],
			},
		},
		{
			label: "dropped structural closer",
			initial: ["function value() {", "  return 1;", "}"].join("\n"),
			input: {
				path: "file.ts",
				edits: [
					{
						anchor: anchor("function value() {", 1),
						end_anchor: anchor("}", 3),
						new_text: "function changed() {\n  return 1;",
					},
				],
			},
		},
	])("preserves anchor rejection and atomicity for $label", async ({ label, initial, input }) => {
		const runtimeDirectory = createTemporaryDirectory(label);
		writeFileSync(join(runtimeDirectory, "file.ts"), initial);
		const runtimeError = await errorMessage(
			createEditTool(runtimeDirectory, { pathPolicy: permissivePathPolicy }).execute(runtimeRequest(input)),
		);
		expect(runtimeError).toMatch(/stale|overlap|closing/i);
		expect(readFileSync(join(runtimeDirectory, "file.ts"), "utf-8")).toBe(initial);
	});

	it.each([
		{ path: "file.txt", oldText: "a", newText: "b", edits: [] },
		{ path: "file.txt" },
		{ path: "file.txt", edits: [] },
	])("preserves mode and payload validation for %#", async (input) => {
		const directory = createTemporaryDirectory("payload");
		writeFileSync(join(directory, "file.txt"), "a");
		const runtimeError = await errorMessage(
			createEditTool(directory, { pathPolicy: permissivePathPolicy }).execute(runtimeRequest(input)),
		);
		expect(runtimeError).toMatch(/not both|missing edit payload|edits array is empty/i);
	});

	it("preserves fuzzy existing-path resolution without rewriting path-like replacement text", async () => {
		const runtimeDirectory = createTemporaryDirectory("path");
		const exactName = "招标文件-发布稿.txt";
		const requestedName = "招标文件 - 发布稿.txt";
		writeFileSync(join(runtimeDirectory, exactName), 'const path = "old.docx";\n');
		const input = { path: requestedName, oldText: '"old.docx"', newText: '"招标文件 - 发布稿.docx"' };
		const runtimeResult = await createEditTool(runtimeDirectory, { pathPolicy: permissivePathPolicy }).execute(
			runtimeRequest(input),
		);
		expect(runtimeResult.content[0]).toMatchObject({ text: expect.stringContaining("Successfully replaced text") });
		expect(readFileSync(join(runtimeDirectory, exactName), "utf-8")).toContain('"招标文件 - 发布稿.docx"');
	});

	it.each([".vetta/skills/file.txt", ".agents/skills/file.txt"])(
		"preserves protected skill path rejection for %s",
		async (path) => {
			const cwd = createTemporaryDirectory("protected");
			const input = { path, oldText: "a", newText: "b" };
			const runtimeError = await errorMessage(
				createEditTool(cwd, {
					pathPolicy: createTestEditPathPolicy({ cwd, knowledgeRoot: join(cwd, "knowledges") }),
				}).execute(runtimeRequest(input)),
			);
			expect(runtimeError).toContain("inside a skill/scene directory");
		},
	);

	it("preserves knowledge wiki rejection", async () => {
		const cwd = createTemporaryDirectory("wiki");
		const knowledgeRoot = join(cwd, "knowledges");
		const input = { path: join(knowledgeRoot, "wiki", "page.md"), oldText: "a", newText: "b" };
		const runtimeError = await errorMessage(
			createEditTool(cwd, { pathPolicy: createTestEditPathPolicy({ cwd, knowledgeRoot }) }).execute(
				runtimeRequest(input),
			),
		);
		expect(runtimeError).toContain("managed exclusively by kb_write_page");
	});

	it("preserves exact-mode operation order and early cancellation", async () => {
		const cwd = createTemporaryDirectory("operations");
		const calls: string[] = [];
		const operations: EditOperations = {
			access: async (path) => {
				calls.push(`access:${path}`);
			},
			readFile: async (path) => {
				calls.push(`read:${path}`);
				return Buffer.from("old");
			},
			writeFile: async (path, content) => {
				calls.push(`write:${path}:${content}`);
			},
		};
		await expect(
			createEditTool(cwd, { operations, pathPolicy: permissivePathPolicy }).execute(
				runtimeRequest({ path: "file.txt", edits: [] }),
			),
		).rejects.toThrow("edits array is empty");
		expect(calls).toEqual([]);

		const controller = new AbortController();
		controller.abort();
		await expect(
			createEditTool(cwd, { operations, pathPolicy: permissivePathPolicy }).execute(
				runtimeRequest({ path: "file.txt", oldText: "old", newText: "new" }, controller.signal),
			),
		).rejects.toThrow("Operation aborted");
		expect(calls).toEqual([]);

		const result = await createEditTool(cwd, { operations, pathPolicy: permissivePathPolicy }).execute(
			runtimeRequest({ path: "file.txt", oldText: "old", newText: "new" }),
		);
		expect(result.content[0]).toMatchObject({ text: "Successfully replaced text in file.txt." });
		expect(calls.map((call) => call.split(":", 1)[0])).toEqual(["access", "read", "write"]);
	});

	it("preserves anchor-mode cooperative cancellation after reading", async () => {
		const cwd = createTemporaryDirectory("anchor-abort");
		const controller = new AbortController();
		const calls: string[] = [];
		const operations: EditOperations = {
			access: async () => {
				calls.push("access");
			},
			readFile: async () => {
				calls.push("read");
				controller.abort();
				return Buffer.from("old");
			},
			writeFile: async () => {
				calls.push("write");
			},
		};
		await expect(
			createEditTool(cwd, { operations, pathPolicy: permissivePathPolicy }).execute(
				runtimeRequest(
					{ path: "file.txt", edits: [{ anchor: anchor("old", 1), new_text: "new" }] },
					controller.signal,
				),
			),
		).rejects.toThrow("Operation aborted");
		expect(calls).toEqual(["access", "read"]);
	});
});
