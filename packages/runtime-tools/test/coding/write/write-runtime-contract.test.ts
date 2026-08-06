import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createWriteTool,
	createWriteToolRegistration,
	selectCodingToolsForScope,
	WRITE_TOOL_CATEGORY,
	WRITE_TOOL_DESCRIPTION,
	WRITE_TOOL_SCOPES,
	type WriteOperations,
	type WritePathPolicy,
	WriteToolInputSchema,
} from "../../../src/coding/index.js";
import { createTestWritePathPolicy } from "../../support/path-policy.js";

const temporaryDirectories: string[] = [];
const permissivePathPolicy: WritePathPolicy = {
	getRejectionReason: () => undefined,
};

afterEach(() => {
	for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
	temporaryDirectories.length = 0;
});

function createTemporaryDirectory(label: string): string {
	const directory = mkdtempSync(join(tmpdir(), `vetta-runtime-write-${label}-`));
	temporaryDirectories.push(directory);
	return directory;
}

function runtimeRequest(
	input: { readonly path: string; readonly content: string },
	signal = new AbortController().signal,
) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "runtime-write",
		input,
		signal,
	};
}

function recordingOperations(calls: string[]): WriteOperations {
	return {
		mkdir: async (directory) => {
			calls.push(`mkdir:${directory}`);
		},
		writeFile: async (path, content) => {
			calls.push(`write:${path}:${content}`);
		},
	};
}

describe("runtime write tool", () => {
	it("keeps the public definition, registration metadata, and full default scope", () => {
		const runtime = createWriteToolRegistration(process.cwd(), { pathPolicy: permissivePathPolicy });
		expect(runtime.tool).toMatchObject({
			name: "write",
			label: "write",
			description: WRITE_TOOL_DESCRIPTION,
			inputSchema: WriteToolInputSchema,
		});
		expect(runtime.scopeUse).toEqual(WRITE_TOOL_SCOPES);
		expect(runtime.category).toBe(WRITE_TOOL_CATEGORY);
		for (const scope of WRITE_TOOL_SCOPES) {
			expect(selectCodingToolsForScope([runtime], scope)).toEqual([runtime.tool]);
		}
	});

	it("preserves local parent creation, verbatim UTF-8 content, result text, and undefined details", async () => {
		const runtimeDirectory = createTemporaryDirectory("local");
		const relativePath = "nested/deep/output.txt";
		const content = 'héllo🙂\nconst path = "招标文件 - 发布稿.docx";\n';
		const runtime = createWriteTool(runtimeDirectory, { pathPolicy: permissivePathPolicy });

		const runtimeResult = await runtime.execute(runtimeRequest({ path: relativePath, content }));
		expect(runtimeResult.content[0]).toMatchObject({ text: expect.stringContaining("Successfully wrote 40 bytes") });
		expect(readFileSync(join(runtimeDirectory, relativePath), "utf-8")).toBe(content);
		expect(runtimeResult.details).toBeUndefined();
	});

	it("preserves custom operation order and content.length success accounting", async () => {
		const cwd = createTemporaryDirectory("operations");
		const runtimeCalls: string[] = [];
		const runtime = createWriteTool(cwd, {
			operations: recordingOperations(runtimeCalls),
			pathPolicy: permissivePathPolicy,
		});
		const input = { path: "nested/file.txt", content: "🙂" };

		const runtimeResult = await runtime.execute(runtimeRequest(input));
		expect(runtimeCalls.map((call) => call.split(":", 1)[0])).toEqual(["mkdir", "write"]);
		expect(runtimeResult.content[0]).toMatchObject({ text: expect.stringContaining("Successfully wrote 2 bytes") });
	});

	it("preserves fuzzy output-path retargeting and its notice", async () => {
		const runtimeDirectory = createTemporaryDirectory("retarget");
		const exactName = "招标文件-发布稿.docx";
		const requestedName = "招标文件 - 发布稿.docx";
		writeFileSync(join(runtimeDirectory, exactName), "old");
		const runtime = createWriteTool(runtimeDirectory, { pathPolicy: permissivePathPolicy });

		const runtimeResult = await runtime.execute(runtimeRequest({ path: requestedName, content: "new" }));
		expect(readFileSync(join(runtimeDirectory, exactName), "utf-8")).toBe("new");
		expect(runtimeResult.content[0]).toMatchObject({ text: expect.stringContaining("[Auto-corrected output path:") });
	});

	it.each([".vetta/skills/output.txt", ".agents/skills/output.txt"])(
		"preserves protected skill path rejection for %s",
		async (path) => {
			const cwd = createTemporaryDirectory("protected");
			const runtime = createWriteTool(cwd, {
				pathPolicy: createTestWritePathPolicy({ cwd, knowledgeRoot: join(cwd, "knowledges") }),
			});
			const input = { path, content: "blocked" };
			const runtimeResult = await runtime.execute(runtimeRequest(input));
			expect(runtimeResult.content[0]).toMatchObject({
				text: expect.stringContaining("inside a skill/scene directory"),
			});
		},
	);

	it("preserves knowledge wiki rejection", async () => {
		const cwd = createTemporaryDirectory("wiki-policy");
		const knowledgeRoot = join(cwd, "knowledges");
		const path = join(knowledgeRoot, "wiki", "page.md");
		const runtime = createWriteTool(cwd, {
			pathPolicy: createTestWritePathPolicy({ cwd, knowledgeRoot }),
		});
		const input = { path, content: "blocked" };
		const runtimeResult = await runtime.execute(runtimeRequest(input));
		expect(runtimeResult.content[0]).toMatchObject({ text: expect.stringContaining("kb_write_page tool") });
	});

	it("preserves early cancellation before filesystem operations", async () => {
		const cwd = createTemporaryDirectory("early-abort");
		const controller = new AbortController();
		controller.abort();
		const runtimeCalls: string[] = [];
		const runtime = createWriteTool(cwd, {
			operations: recordingOperations(runtimeCalls),
			pathPolicy: permissivePathPolicy,
		});
		const input = { path: "output.txt", content: "blocked" };
		await expect(runtime.execute(runtimeRequest(input, controller.signal))).rejects.toThrow("Operation aborted");
		expect(runtimeCalls).toEqual([]);
	});

	it("preserves cancellation during mkdir and prevents the later write", async () => {
		const cwd = createTemporaryDirectory("mkdir-abort");
		const runtimeController = new AbortController();
		let resolveRuntimeMkdir: (() => void) | undefined;
		const runtimeWrites: string[] = [];
		const runtime = createWriteTool(cwd, {
			operations: {
				mkdir: () =>
					new Promise<void>((resolve) => {
						resolveRuntimeMkdir = resolve;
					}),
				writeFile: async (path) => {
					runtimeWrites.push(path);
				},
			},
			pathPolicy: permissivePathPolicy,
		});
		const input = { path: "output.txt", content: "blocked" };
		const runtimePromise = runtime.execute(runtimeRequest(input, runtimeController.signal));
		runtimeController.abort();
		await expect(runtimePromise).rejects.toThrow("Operation aborted");
		resolveRuntimeMkdir?.();
		await Promise.resolve();
		expect(runtimeWrites).toEqual([]);
	});

	it.each(["mkdir", "writeFile"] as const)("preserves %s operation errors", async (failurePoint) => {
		const cwd = createTemporaryDirectory(`error-${failurePoint}`);
		const operations = (): WriteOperations => ({
			mkdir: async () => {
				if (failurePoint === "mkdir") throw new Error("mkdir failed");
			},
			writeFile: async () => {
				if (failurePoint === "writeFile") throw new Error("write failed");
			},
		});
		const runtime = createWriteTool(cwd, {
			operations: operations(),
			pathPolicy: permissivePathPolicy,
		});
		const input = { path: "output.txt", content: "content" };
		await expect(runtime.execute(runtimeRequest(input))).rejects.toThrow(
			`${failurePoint === "mkdir" ? "mkdir" : "write"} failed`,
		);
	});
});
