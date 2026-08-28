import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createGrepTool,
	createGrepToolRegistration,
	GREP_TOOL_DESCRIPTION,
	GrepToolInputSchema,
} from "../../../src/coding/index.js";
import { anchorLineHash } from "../../../src/coding/shared/anchors.js";

describe("runtime grep tool", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("keeps the public runtime definition", () => {
		const runtime = createGrepToolRegistration(process.cwd(), { rgPath: "rg" });
		expect(runtime.tool).toMatchObject({
			name: "grep",
			label: "grep",
			description: GREP_TOOL_DESCRIPTION,
			inputSchema: GrepToolInputSchema,
		});
	});

	it("uses an injected host resolver without downloading or discovering tools itself", async () => {
		const resolvedTools: string[] = [];
		const runtime = createGrepTool(process.cwd(), {
			operations: {
				isDirectory: () => true,
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

	it("anchors a non-UTF-8 line to the same hash the read tool would produce", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-grep-bytes-"));
		temporaryDirectories.push(directory);
		const filePath = join(directory, "binary.txt");
		// A latin-1 byte makes ripgrep report the line as base64 `bytes` instead of `text`.
		writeFileSync(filePath, Buffer.concat([Buffer.from("caf"), Buffer.from([0xe9]), Buffer.from(" marker\n")]));

		const runtime = createGrepTool(directory, { rgPath: "rg" });
		const runtimeResult = await runtime.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-grep",
			input: { pattern: "marker", path: filePath },
			signal: new AbortController().signal,
		});

		const text = (runtimeResult.content[0] as { text: string }).text;
		const anchor = /^binary\.txt:1:([0-9a-z]{4}):/.exec(text)?.[1];
		expect(anchor).toBeDefined();
		// The `edit` tool resolves an anchor by hashing the file's own line, so the hash grep
		// hands out must equal the hash of that exact on-disk line.
		const onDiskLine = readFileSync(filePath, "utf8").split("\n")[0];
		expect(anchor).toBe(anchorLineHash(onDiskLine));
	});

	it("returns only file paths when filesOnly is set", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-grep-files-"));
		temporaryDirectories.push(directory);
		writeFileSync(join(directory, "a.txt"), "needle here\nneedle again\n");
		writeFileSync(join(directory, "b.txt"), "nothing\n");

		const runtime = createGrepTool(directory, { rgPath: "rg" });
		const runtimeResult = await runtime.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-grep",
			input: { pattern: "needle", filesOnly: true },
			signal: new AbortController().signal,
		});

		expect(runtimeResult.content).toEqual([{ type: "text", text: "a.txt" }]);
	});

	it("reports a missing path with the working directory", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-tools-grep-missing-"));
		temporaryDirectories.push(directory);
		const runtime = createGrepTool(directory, { rgPath: "rg" });

		await expect(
			runtime.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-grep",
				input: { pattern: "anything", path: "does-not-exist" },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow(`Note: your current working directory is ${directory}`);
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
