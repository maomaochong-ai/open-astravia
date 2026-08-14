import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const rawResults = ["C:/workspace/src/index.ts", "C:/workspace/src/index.ts", "C:/workspace/src/components/"];

function operations() {
	return {
		isDirectory: (absolutePath: string) => {
			expect(absolutePath.replace(/\\/g, "/")).toBe("C:/workspace");
			return true;
		},
		glob: async (
			_pattern: string,
			cwd: string,
			options: { readonly limit: number; readonly signal?: AbortSignal },
		) => {
			expect(cwd.replace(/\\/g, "/")).toBe("C:/workspace");
			expect(options.limit).toBe(100);
			expect(options.signal?.aborted ?? false).toBe(false);
			return rawResults;
		},
	};
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

	it("preserves deduplication, relative paths, directory markers, and result details", async () => {
		const runtime = createGlobTool("C:/workspace", { operations: operations() });
		const input = { pattern: "**/*.ts", path: "." };
		const runtimeResult = await runtime.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-glob",
			input,
			signal: new AbortController().signal,
		});

		expect(runtimeResult).toMatchObject({
			content: [{ type: "text", text: "src/index.ts\nsrc/components/" }],
			details: {
				numFiles: 2,
			},
		});
		expect(runtimeResult.details).toMatchObject({
			durationMs: expect.any(Number),
		});
	});

	it("preserves the legacy behavior for an already cancelled custom operation", async () => {
		const controller = new AbortController();
		controller.abort();
		let called = false;
		const runtime = createGlobTool("C:/workspace", {
			operations: {
				isDirectory: () => true,
				glob: () => {
					called = true;
					return [];
				},
			},
		});

		await expect(
			runtime.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-glob",
				input: { pattern: "*" },
				signal: controller.signal,
			}),
		).resolves.toMatchObject({
			content: [{ type: "text", text: "No files or directories found matching pattern" }],
		});
		expect(called).toBe(true);
	});

	it("uses the host glob implementation with absolute patterns and nested gitignore rules", async () => {
		const directory = mkdtempSync(join(tmpdir(), "runtime-glob-default-"));
		try {
			mkdirSync(join(directory, "src"));
			writeFileSync(join(directory, ".gitignore"), "ignored.ts\n");
			writeFileSync(join(directory, "src", "kept.ts"), "export {};\n");
			writeFileSync(join(directory, "ignored.ts"), "ignored\n");

			const runtime = createGlobTool(directory);
			const input = { pattern: join(directory, "**", "*.ts") };
			const runtimeResult = await runtime.execute({
				sessionId: "session-1",
				turnId: "turn-1",
				toolCallId: "runtime-glob",
				input,
				signal: new AbortController().signal,
			});

			expect(runtimeResult.content).toEqual([{ type: "text", text: "src/kept.ts" }]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
