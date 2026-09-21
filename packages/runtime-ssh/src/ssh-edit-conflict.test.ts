import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { buildSshHelperForTests, createLoopbackSshConnection } from "@vetta/ssh-transport/testing";
import { describe, expect, it } from "vitest";
import { createSshEditOperations } from "./ssh-file-operations.js";
import { createSshCodingToolEnvironment } from "./ssh-tool-environment.js";

const helperBinary = buildSshHelperForTests();

describe.skipIf(!helperBinary)("远端 edit 的并发保护（由 helper 在远端核对）", () => {
	const connect = async () => {
		const connection = createLoopbackSshConnection("loopback", { helper: { resolveBinary: () => helperBinary } });
		if (!(await connection.helper())) throw new Error("helper did not come up");
		return connection;
	};

	it("读与写之间文件被别人改了：拒绝覆盖，并让模型重新读", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "vetta-edit-conflict-")));
		const file = join(dir, "config.ts");
		writeFileSync(file, "export const port = 3000;\n");
		const operations = createSshEditOperations(await connect());

		await operations.readFile(file);
		// 同事在这期间推了一个改动，CI 把它同步到了这台机器上。
		writeFileSync(file, "export const port = 9999;\n");

		await expect(operations.writeFile(file, "export const port = 8080;\n")).rejects.toThrow(
			/modified on the remote host after it was read/,
		);
		expect(readFileSync(file, "utf8")).toBe("export const port = 9999;\n");

		// 重新读过之后就能写了。
		await operations.readFile(file);
		await operations.writeFile(file, "export const port = 8080;\n");
		expect(readFileSync(file, "utf8")).toBe("export const port = 8080;\n");
	});

	it("没有外人插手时，edit 工具连续改同一个文件不受影响", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "vetta-edit-conflict-")));
		writeFileSync(join(dir, "main.ts"), "const a = 1;\nconst b = 2;\n");
		const environment = createSshCodingToolEnvironment({
			connection: await connect(),
			remoteCwd: dir,
			editPathPolicy: { getRejectionReason: () => undefined },
			writePathPolicy: { getRejectionReason: () => undefined },
		});
		const edit = environment.registrations.find((item) => item.tool.name === "edit")?.tool;
		const run = (input: Record<string, unknown>): Promise<RuntimeToolResult> =>
			edit?.execute({ input, signal: new AbortController().signal } as never) as Promise<RuntimeToolResult>;

		await run({ path: "main.ts", oldText: "a = 1", newText: "a = 10" });
		await run({ path: "main.ts", oldText: "b = 2", newText: "b = 20" });

		expect(readFileSync(join(dir, "main.ts"), "utf8")).toBe("const a = 10;\nconst b = 20;\n");
	});
});
