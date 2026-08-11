import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createGrepTool,
	createGrepToolRegistration,
	GREP_TOOL_CATEGORY,
	GREP_TOOL_DESCRIPTION,
	GREP_TOOL_SCOPES,
	GrepToolInputSchema,
	selectCodingToolsForScope,
} from "../../../src/coding/index.js";

describe("runtime grep tool", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("keeps the public definition and registration metadata", () => {
		const runtime = createGrepToolRegistration(process.cwd(), { rgPath: "rg" });
		expect(runtime.tool).toMatchObject({
			name: "grep",
			label: "grep",
			description: GREP_TOOL_DESCRIPTION,
			inputSchema: GrepToolInputSchema,
		});
		expect(runtime.scopeUse).toEqual(GREP_TOOL_SCOPES);
		expect(runtime.category).toBe(GREP_TOOL_CATEGORY);
		expect(selectCodingToolsForScope([runtime], "project").map(({ name }) => name)).toEqual(["grep"]);
	});

	it("uses an injected host resolver without downloading or discovering tools itself", async () => {
		const resolvedTools: string[] = [];
		const runtime = createGrepTool(process.cwd(), {
			operations: {
				isDirectory: () => true,
				readFile: () => "",
			},
			executableResolver: {
				resolve: async (tool) => {
					resolvedTools.push(tool);
					return undefined;
				},
			},
		});

		await expect(
			runtime.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-grep",
				input: { pattern: "never-called" },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("ripgrep (rg) is not available and could not be downloaded");
		expect(resolvedTools).toEqual(["rg"]);
	});

	it("resolves the executable again after a runtime availability change", async () => {
		let resolutions = 0;
		const runtime = createGrepTool(process.cwd(), {
			operations: {
				isDirectory: () => true,
				readFile: () => "",
			},
			executableResolver: {
				resolve: async () => {
					resolutions += 1;
					return undefined;
				},
			},
		});

		for (let attempt = 0; attempt < 2; attempt += 1) {
			await expect(
				runtime.execute({
					sessionId: "session-1",
					turnId: `turn-${attempt}`,
					toolCallId: `runtime-grep-${attempt}`,
					input: { pattern: "never-called" },
					signal: new AbortController().signal,
				}),
			).rejects.toThrow("ripgrep (rg) is not available and could not be downloaded");
		}

		expect(resolutions).toBe(2);
	});

	it("preserves matching output, context lines, anchors, and limit notices", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-grep-"));
		temporaryDirectories.push(directory);
		const filePath = join(directory, "context.txt");
		writeFileSync(filePath, ["before", "match one", "after", "middle", "match two", "after two"].join("\n"));

		const runtime = createGrepTool(directory, { rgPath: "rg" });
		const input = { pattern: "match", path: filePath, limit: 1, context: 1 };
		const runtimeResult = await runtime.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-grep",
			input,
			signal: new AbortController().signal,
		});

		expect(runtimeResult.content).toEqual([
			{
				type: "text",
				text: expect.stringMatching(
					/^context\.txt-1:[0-9a-z]{4}- before\ncontext\.txt:2:[0-9a-z]{4}: match one\ncontext\.txt-3:[0-9a-z]{4}- after\n\n\[1 matches limit reached\. Use limit=2 for more, or refine pattern\]$/,
				),
			},
		]);
		expect(runtimeResult.details).toMatchObject({ matchLimitReached: 1 });
	});

	it("keeps cancellation at the runtime tool boundary", async () => {
		const controller = new AbortController();
		controller.abort();
		const runtime = createGrepTool(process.cwd(), { rgPath: "rg" });

		await expect(
			runtime.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-grep",
				input: { pattern: "never-called" },
				signal: controller.signal,
			}),
		).rejects.toThrow("Operation aborted");
	});
});
