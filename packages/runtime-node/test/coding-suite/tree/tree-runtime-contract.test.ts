import { describe, expect, it } from "vitest";
import {
	createTreeTool,
	createTreeToolRegistration,
	selectCodingToolsForScope,
	TREE_TOOL_CATEGORY,
	TREE_TOOL_DESCRIPTION,
	TREE_TOOL_SCOPES,
	type TreeOperations,
	TreeToolInputSchema,
} from "../../../src/coding/index.js";

interface ScanResult {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

interface FixtureOptions {
	readonly exists?: boolean;
	readonly isDirectory?: boolean;
	readonly fdPath?: string;
	readonly directories?: ScanResult;
	readonly files?: ScanResult;
}

function createOperations(options: FixtureOptions = {}) {
	const calls: Array<{ readonly fdPath: string; readonly args: readonly string[] }> = [];
	const runFd = async (fdPath: string, args: readonly string[]): Promise<ScanResult> => {
		calls.push({ fdPath, args: [...args] });
		return args[2] === "d"
			? (options.directories ?? {
					status: 0,
					stdout: "src\nsrc/core\npackages\n.hidden\n",
					stderr: "",
				})
			: (options.files ?? {
					status: 0,
					stdout: "README.md\nsrc/core/index.ts\npackages/zeta.ts\n.hidden/secret\n",
					stderr: "",
				});
	};
	return {
		calls,
		runtime: {
			exists: () => options.exists ?? true,
			stat: () => ({ isDirectory: () => options.isDirectory ?? true }),
			runFd,
		} satisfies TreeOperations,
	};
}

function runtimeRequest(input: {
	readonly path?: string;
	readonly maxDepth?: number;
	readonly limit?: number;
	readonly includeFiles?: boolean;
	readonly includeHidden?: boolean;
	readonly ignore?: string[];
}) {
	return {
		sessionId: "session-1",
		turnId: "turn-1",
		toolCallId: "runtime-tree",
		input,
		signal: new AbortController().signal,
	};
}

describe("runtime tree tool", () => {
	it("keeps the public definition, registration metadata, and full default scope", () => {
		const runtime = createTreeToolRegistration(process.cwd(), { operations: createOperations().runtime });
		expect(runtime.tool).toMatchObject({
			name: "dir_tree",
			label: "dir_tree",
			description: TREE_TOOL_DESCRIPTION,
			inputSchema: TreeToolInputSchema,
		});
		expect(runtime.scopeUse).toEqual(TREE_TOOL_SCOPES);
		expect(runtime.category).toBe(TREE_TOOL_CATEGORY);
		for (const scope of TREE_TOOL_SCOPES) {
			expect(selectCodingToolsForScope([runtime], scope)).toEqual([runtime.tool]);
		}
	});

	it("preserves hierarchy, sorting, child counts, node tags, and fd arguments", async () => {
		const runtimeFixture = createOperations();
		const runtime = createTreeTool(process.cwd(), {
			operations: runtimeFixture.runtime,
			fdPath: "fixture-fd",
		});
		const input = {
			path: ".",
			maxDepth: 5,
			includeHidden: true,
			ignore: ["dist", "  ", "*.generated.ts"],
		};

		const runtimeResult = await runtime.execute(runtimeRequest(input));
		expect(runtimeFixture.calls).toHaveLength(2);
		expect(runtimeResult.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("[D] src (d:1, f:0) (type=dir)"),
		});
	});

	it("preserves directory-only mode, floored limits, and limit notices", async () => {
		const options = {
			directories: { status: 0, stdout: "zeta\nalpha\nalpha/child\n", stderr: "" },
			files: { status: 0, stdout: "alpha/file.ts\n", stderr: "" },
		} satisfies FixtureOptions;
		const runtimeFixture = createOperations(options);
		const runtime = createTreeTool(process.cwd(), { operations: runtimeFixture.runtime, fdPath: "fixture-fd" });
		const input = { includeFiles: false, maxDepth: 1.9, limit: 2.8 };

		const runtimeResult = await runtime.execute(runtimeRequest(input));
		expect(runtimeFixture.calls).toHaveLength(1);
		expect(runtimeResult.details).toMatchObject({ nodeLimitReached: 2, nodesRendered: 2 });
	});

	it("preserves scan-limit and output-byte-limit details", async () => {
		const paths = Array.from({ length: 2000 }, (_, index) => `${String(index).padStart(4, "0")}-${"x".repeat(120)}`);
		const options = {
			directories: { status: 0, stdout: paths.join("\n"), stderr: "" },
			files: { status: 0, stdout: "", stderr: "" },
		} satisfies FixtureOptions;
		const runtimeFixture = createOperations(options);
		const runtime = createTreeTool(process.cwd(), { operations: runtimeFixture.runtime, fdPath: "fixture-fd" });

		const runtimeResult = await runtime.execute(runtimeRequest({ maxDepth: 2, limit: 500 }));
		expect(runtimeResult.details).toMatchObject({
			nodeLimitReached: 500,
			scanLimitReached: 2000,
			truncation: { truncated: true, truncatedBy: "bytes" },
		});
	});

	it("resolves fd on every execution and preserves unavailable-fd errors", async () => {
		let resolutions = 0;
		const runtime = createTreeTool(process.cwd(), {
			operations: createOperations().runtime,
			executableResolver: {
				resolve: async () => {
					resolutions += 1;
					return undefined;
				},
			},
		});
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await expect(runtime.execute(runtimeRequest({}))).rejects.toThrow(
				"fd is not available and could not be downloaded",
			);
		}
		expect(resolutions).toBe(2);
	});

	it.each([
		{
			name: "missing path",
			options: { exists: false },
			expected: "Path not found:",
		},
		{
			name: "non-directory path",
			options: { isDirectory: false },
			expected: "Not a directory:",
		},
		{
			name: "directory scan failure",
			options: { directories: { status: 2, stdout: "", stderr: "scan failed" } },
			expected: "Failed to build directory tree: scan failed",
		},
		{
			name: "file scan failure",
			options: { files: { status: null, stdout: "", stderr: "" } },
			expected: "Failed to build directory tree: fd exited with code null",
		},
	] satisfies ReadonlyArray<{ name: string; options: FixtureOptions; expected: string }>)(
		"preserves $name errors",
		async ({ options, expected }) => {
			const runtimeFixture = createOperations(options);
			const runtime = createTreeTool(process.cwd(), { operations: runtimeFixture.runtime, fdPath: "fixture-fd" });
			await expect(runtime.execute(runtimeRequest({}))).rejects.toThrow(expected);
		},
	);

	it("preserves early cancellation", async () => {
		const controller = new AbortController();
		controller.abort();
		const runtime = createTreeTool(process.cwd(), { operations: createOperations().runtime, fdPath: "fixture-fd" });
		await expect(runtime.execute({ ...runtimeRequest({}), signal: controller.signal })).rejects.toThrow(
			"Operation aborted",
		);
	});
});
