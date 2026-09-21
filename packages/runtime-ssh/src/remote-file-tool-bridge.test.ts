import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import { createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it } from "vitest";
import { createRemoteFileToolRegistrations } from "./remote-file-tool-bridge.js";

/**
 * 顶替 OCR / PDF 引擎的本机工具：与真工具同一形状——读 `input`，把产物写到 `output`
 * （缺省 `<input>.out` 落在输入旁边），并在结果里报告产物路径。
 */
const seenLocalPaths: string[] = [];
function createLocalRegistrations(localCwd: string): CodingToolRegistration[] {
	return [
		{
			tool: {
				name: "fake_convert",
				label: "fake_convert",
				description: "test double",
				inputSchema: {},
				async execute(request: { input: { input: string; output?: string } }): Promise<RuntimeToolResult> {
					const inputPath = isAbsolute(request.input.input)
						? request.input.input
						: resolve(localCwd, request.input.input);
					const outputPath = request.input.output ?? `${inputPath}.out`;
					seenLocalPaths.push(inputPath);
					await writeFile(outputPath, (await readFile(inputPath, "utf8")).toUpperCase());
					return { content: [{ type: "text", text: `converted ${inputPath}\noutput: ${outputPath}` }] };
				},
			},
		} as unknown as CodingToolRegistration,
	];
}

function createBridge(remoteCwd: string) {
	const [registration] = createRemoteFileToolRegistrations({
		connection: createLoopbackSshConnection(),
		remoteCwd,
		createLocalRegistrations,
	});
	return async (input: Record<string, unknown>): Promise<string> => {
		const result = await registration.tool.execute({ input, signal: new AbortController().signal } as never);
		return result.content.map((item) => (item.type === "text" ? item.text : "")).join("");
	};
}

describe("依赖本机引擎的工具桥接到远端文件", () => {
	it("产物缺省落在远端的输入旁边，结果里报告的是远端路径", async () => {
		const remoteCwd = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-docs-")));
		writeFileSync(join(remoteCwd, "scan one.txt"), "hello");
		const run = createBridge(remoteCwd);

		const text = await run({ input: "scan one.txt" });

		expect(readFileSync(join(remoteCwd, "scan one.txt.out"), "utf8")).toBe("HELLO");
		expect(text).toBe(`converted ${remoteCwd}/scan one.txt\noutput: ${remoteCwd}/scan one.txt.out`);
	});

	it("指定的 output 按远端工作目录解析，缺的目录一并建好", async () => {
		const remoteCwd = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-docs-")));
		writeFileSync(join(remoteCwd, "a.txt"), "x");
		const run = createBridge(remoteCwd);

		const text = await run({ input: "a.txt", output: "build/out/a.result" });

		expect(readFileSync(join(remoteCwd, "build/out/a.result"), "utf8")).toBe("X");
		expect(text).toContain(`output: ${remoteCwd}/build/out/a.result`);
	});

	it("本机只在临时目录里处理，用完即清，不往远端多留东西", async () => {
		const remoteCwd = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-docs-")));
		writeFileSync(join(remoteCwd, "a.txt"), "x");
		seenLocalPaths.length = 0;

		await createBridge(remoteCwd)({ input: "a.txt" });

		expect(seenLocalPaths).toHaveLength(1);
		expect(seenLocalPaths[0].startsWith(remoteCwd)).toBe(false);
		expect(existsSync(seenLocalPaths[0])).toBe(false);
	});

	it("远端没有这个输入时失败，而不是对着一个空文件去跑", async () => {
		const remoteCwd = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-docs-")));
		await expect(createBridge(remoteCwd)({ input: "missing.pdf" })).rejects.toThrow();
	});
});
