import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { createSshCodingToolEnvironment } from "./ssh-tool-environment.js";
import { createLoopbackSshConnection } from "./test-support/loopback-ssh.js";

function createProject(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "vetta-remote-project-")));
	mkdirSync(join(root, "src/it's here"), { recursive: true });
	writeFileSync(join(root, "src/server.ts"), "const port = 3000;\nexport const cost = '$HOME';\n");
	writeFileSync(join(root, "src/it's here/notes.md"), "port forwarding\n");
	writeFileSync(join(root, "README.md"), "# demo\n");
	return root;
}

function createTools(remoteCwd: string) {
	const environment = createSshCodingToolEnvironment({
		connection: createLoopbackSshConnection(),
		remoteCwd,
		editPathPolicy: { getRejectionReason: () => undefined },
		writePathPolicy: { getRejectionReason: () => undefined },
	});
	return async (name: string, input: Record<string, unknown>): Promise<string> => {
		const tool = environment.registrations.find((item) => item.tool.name === name)?.tool;
		if (!tool) throw new Error(`tool not registered: ${name}`);
		const result: RuntimeToolResult = await tool.execute({
			sessionId: "s",
			turnId: "t",
			toolCallId: "c",
			input,
			signal: new AbortController().signal,
		} as never);
		return result.content.map((item) => (item.type === "text" ? item.text : "")).join("");
	};
}

describe("远程项目里的搜索工具（经回环 SSH 跑在真实 shell 上）", () => {
	it("grep 搜的是远端项目，命中带可用于 edit 的行锚点", async () => {
		const run = createTools(createProject());
		const output = await run("grep", { pattern: "port" });
		expect(output).toMatch(/^src\/server\.ts:1:[0-9a-z]+: const port = 3000;$/m);
		expect(output).toContain("src/it's here/notes.md:1:");
	});

	it("搜索模式里的 shell 元字符按字面量到达 ripgrep，不会被远端 shell 展开", async () => {
		const run = createTools(createProject());
		const output = await run("grep", { pattern: "'$HOME'", literal: true });
		expect(output).toContain("src/server.ts:2:");
	});

	it("glob、find 与 dir_tree 列出的是远端的文件", async () => {
		const run = createTools(createProject());
		expect((await run("glob", { pattern: "**/*.ts" })).trim()).toBe("src/server.ts");
		expect(await run("find", { pattern: "*.md" })).toContain("README.md");
		const tree = await run("dir_tree", {});
		expect(tree).toContain("src");
		expect(tree).toContain("server.ts");
	});

	it("路径不存在时照常报找不到，而不是静默给出空结果", async () => {
		const run = createTools(createProject());
		await expect(run("grep", { pattern: "x", path: "missing" })).rejects.toThrow(/Path not found/);
	});
});
