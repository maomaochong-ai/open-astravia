import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createGlobTool,
	createGlobToolRegistration,
	GLOB_TOOL_CATEGORY,
	GLOB_TOOL_DESCRIPTION,
	GLOB_TOOL_SCOPES,
	GlobToolInputSchema,
	selectCodingToolsForScope,
} from "../../../src/coding/index.js";

// A drive-letter path is not absolute on posix, so the tool resolves it against the process
// cwd. The expectation is computed the same way rather than hardcoded, which keeps the
// assertion about "isDirectory sees the resolved search root" instead of about the platform.
const WORKSPACE = "C:/workspace";
const RESOLVED_WORKSPACE = resolve(WORKSPACE).replace(/\\/g, "/");
const rawResults = ["src/index.ts", "src/index.ts", "src/app.ts"];

function operations() {
	return {
		isDirectory: (absolutePath: string) => {
			expect(absolutePath.replace(/\\/g, "/")).toBe(RESOLVED_WORKSPACE);
			return true;
		},
		glob: async (
			_pattern: string,
			cwd: string,
			options: { readonly limit: number; readonly signal?: AbortSignal },
		) => {
			expect(cwd.replace(/\\/g, "/")).toBe(RESOLVED_WORKSPACE);
			expect(options.limit).toBe(100);
			expect(options.signal?.aborted ?? false).toBe(false);
			return rawResults;
		},
	};
}

function execute(runtime: ReturnType<typeof createGlobTool>, input: unknown, signal?: AbortSignal) {
	return runtime.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "runtime-glob",
		input: input as never,
		signal: signal ?? new AbortController().signal,
	});
}

describe("runtime glob tool", () => {
	it("keeps the public definition and scenario exposure", () => {
		const runtime = createGlobToolRegistration(process.cwd(), { operations: operations() });
		expect(runtime.tool).toMatchObject({
			name: "glob",
			label: "glob",
			description: GLOB_TOOL_DESCRIPTION,
			inputSchema: GlobToolInputSchema,
		});
		expect(runtime.scopeUse).toEqual(GLOB_TOOL_SCOPES);
		expect(runtime.category).toBe(GLOB_TOOL_CATEGORY);
		expect(selectCodingToolsForScope([runtime], "project").map(({ name }) => name)).toEqual(["glob"]);
	});

	it("preserves deduplication, relative paths, and result details", async () => {
		const runtime = createGlobTool(WORKSPACE, { operations: operations() });
		const runtimeResult = await execute(runtime, { pattern: "**/*.ts", path: "." });

		expect(runtimeResult).toMatchObject({
			content: [{ type: "text", text: "src/index.ts\nsrc/app.ts" }],
			details: { numFiles: 2 },
		});
		expect(runtimeResult.details).toMatchObject({ durationMs: expect.any(Number) });
	});

	it("preserves the legacy behavior for an already cancelled custom operation", async () => {
		const controller = new AbortController();
		controller.abort();
		let called = false;
		const runtime = createGlobTool(WORKSPACE, {
			operations: {
				isDirectory: () => true,
				glob: () => {
					called = true;
					return [];
				},
			},
		});

		await expect(execute(runtime, { pattern: "*" }, controller.signal)).resolves.toMatchObject({
			content: [{ type: "text", text: "No files found matching pattern" }],
		});
		expect(called).toBe(true);
	});

	it("uses the host ripgrep implementation with absolute patterns and nested gitignore rules", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-glob-default-"));
		try {
			mkdirSync(join(directory, "src"));
			writeFileSync(join(directory, ".gitignore"), "ignored.ts\n");
			writeFileSync(join(directory, "src", "kept.ts"), "export {};\n");
			writeFileSync(join(directory, "ignored.ts"), "ignored\n");

			const runtime = createGlobTool(directory);
			const runtimeResult = await execute(runtime, { pattern: join(directory, "**", "*.ts") });

			expect(runtimeResult.content).toEqual([{ type: "text", text: "src/kept.ts" }]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("returns files only, never the directories that contain them", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-glob-files-"));
		try {
			mkdirSync(join(directory, "components"));
			writeFileSync(join(directory, "components", "button.ts"), "export {};\n");

			const runtime = createGlobTool(directory);
			const runtimeResult = await execute(runtime, { pattern: "**" });

			expect(runtimeResult.content).toEqual([{ type: "text", text: "components/button.ts" }]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("orders results with the most recently modified file first", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-glob-mtime-"));
		try {
			for (const [name, secondsAgo] of [
				["oldest.ts", 3_000],
				["middle.ts", 2_000],
				["newest.ts", 1_000],
			] as const) {
				const filePath = join(directory, name);
				writeFileSync(filePath, "export {};\n");
				const stamp = new Date(Date.now() - secondsAgo * 1000);
				utimesSync(filePath, stamp, stamp);
			}

			const runtime = createGlobTool(directory);
			const runtimeResult = await execute(runtime, { pattern: "*.ts" });

			expect(runtimeResult.content).toEqual([{ type: "text", text: "newest.ts\nmiddle.ts\noldest.ts" }]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("caps the page at the limit and says the page is the most recently modified slice", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-glob-limit-"));
		try {
			for (let index = 0; index < 5; index++) {
				const filePath = join(directory, `file-${index}.ts`);
				writeFileSync(filePath, "export {};\n");
				const stamp = new Date(Date.now() - (5 - index) * 60_000);
				utimesSync(filePath, stamp, stamp);
			}

			const runtime = createGlobTool(directory);
			const runtimeResult = await execute(runtime, { pattern: "*.ts", limit: 2 });
			const text = (runtimeResult.content[0] as { text: string }).text;

			expect(text.split("\n\n")[0]).toBe("file-4.ts\nfile-3.ts");
			expect(text).toContain("most recently modified");
			expect(runtimeResult.details).toMatchObject({ resultLimitReached: 2, numFiles: 2 });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
