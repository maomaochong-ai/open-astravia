import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createFindTool,
	createFindToolRegistration,
	FIND_TOOL_DESCRIPTION,
	FindToolInputSchema,
} from "../../../src/coding/index.js";

const files = ["visible.txt", ".secret/hidden.txt", "src/index.ts"];

function operations() {
	return {
		exists: () => true,
		glob: async (
			_pattern: string,
			cwd: string,
			options: { readonly ignore: readonly string[]; readonly limit: number },
		) => {
			expect(cwd.replace(/\\/g, "/")).toBe(resolve("C:/workspace").replace(/\\/g, "/"));
			expect(options.ignore).toEqual(["**/node_modules/**", "**/.git/**"]);
			return files.slice(0, options.limit).map((file) => `${cwd}/${file}`);
		},
	};
}

describe("runtime find tool", () => {
	it("keeps the public runtime definition", () => {
		const runtime = createFindToolRegistration(process.cwd(), { operations: operations() });
		expect(runtime.tool).toMatchObject({
			name: "find",
			label: "find",
			description: FIND_TOOL_DESCRIPTION,
			inputSchema: FindToolInputSchema,
		});
	});

	it("uses an injected host resolver without downloading or discovering tools itself", async () => {
		const resolvedTools: string[] = [];
		const runtime = createFindTool(process.cwd(), {
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
				toolCallId: "runtime-find",
				input: { pattern: "*.ts" },
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("fd is not available and could not be downloaded");
		expect(resolvedTools).toEqual(["fd"]);
	});

	it("resolves the executable again after a runtime availability change", async () => {
		let resolutions = 0;
		const runtime = createFindTool(process.cwd(), {
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
					toolCallId: `runtime-find-${attempt}`,
					input: { pattern: "*.ts" },
					signal: new AbortController().signal,
				}),
			).rejects.toThrow("fd is not available and could not be downloaded");
		}

		expect(resolutions).toBe(2);
	});

	it("preserves custom operation results, relative paths, and empty results", async () => {
		const runtime = createFindTool("C:/workspace", { operations: operations() });
		const input = { pattern: "**/*", path: "." };

		const runtimeResult = await runtime.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "runtime-find",
			input,
			signal: new AbortController().signal,
		});

		expect(runtimeResult.content).toEqual([
			{
				type: "text",
				text: files.join("\n"),
			},
		]);
	});
});
