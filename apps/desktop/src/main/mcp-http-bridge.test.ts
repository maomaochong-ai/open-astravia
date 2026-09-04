import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 桥接进程的端到端验证：起一个只会说 HTTP MCP 的假服务（就像小红书官方 server），
 * 通过 stdio 驱动桥接，确认端口分配、就绪等待、转发与进程收尾都成立。
 */

const roots: string[] = [];
const PORT_TOKEN = `\${VETTA_MCP_PORT}`;

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 假服务：从 -port=:<n> 取端口，对 /mcp 的 POST 回显一条 JSON-RPC 结果。 */
const FAKE_SERVICE = `
import { createServer } from "node:http";
const portArg = process.argv.find((value) => value.startsWith("-port=")) ?? "";
const port = Number(portArg.slice("-port=:".length));
if (!port) { process.exit(3); }
createServer((request, response) => {
  if (request.method !== "POST" || !request.url?.startsWith("/mcp")) {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const message = JSON.parse(body);
    response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "session-1" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { echo: message.method, cookies: process.env.COOKIES_PATH },
    }));
  });
}).listen(port, "127.0.0.1");
`;

async function fakeService(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-bridge-test-"));
	roots.push(root);
	const path = join(root, "service.mjs");
	await writeFile(path, FAKE_SERVICE, "utf-8");
	return path;
}

describe("mcp-http-bridge", () => {
	it("拉起本地 HTTP 服务并在 stdio 上透传 MCP", async () => {
		const servicePath = await fakeService();
		const spec = {
			schemaVersion: 1,
			command: process.execPath,
			args: [servicePath, `-port=:${PORT_TOKEN}`],
			env: { COOKIES_PATH: "/tmp/demo-cookies.json" },
			path: "/mcp",
			readyTimeoutMs: 20_000,
		};

		// bun 直接跑 TS，比 bunx tsx 少两层进程：整套用例并行时不必为此抢资源
		const bridge = spawn("bun", [join(process.cwd(), "src/main/mcp-http-bridge.ts"), JSON.stringify(spec)], {
			stdio: ["pipe", "pipe", "pipe"],
		});
		try {
			const line = new Promise<string>((resolve, reject) => {
				let buffer = "";
				bridge.stdout.setEncoding("utf8");
				bridge.stdout.on("data", (chunk: string) => {
					buffer += chunk;
					const newline = buffer.indexOf("\n");
					if (newline >= 0) resolve(buffer.slice(0, newline));
				});
				bridge.on("exit", (code) => reject(new Error(`bridge exited early: ${code}`)));
			});
			bridge.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`);

			expect(JSON.parse(await line)).toEqual({
				jsonrpc: "2.0",
				id: 1,
				// 端口占位符替换成功、env 透传到被托管进程，才可能得到这条回显
				result: { echo: "initialize", cookies: "/tmp/demo-cookies.json" },
			});
		} finally {
			bridge.kill();
		}
	}, 60_000);
});
