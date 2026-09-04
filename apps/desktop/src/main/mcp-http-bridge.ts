/**
 * 受管本地 HTTP MCP 服务的桥接进程（独立入口，由 MCP stdio 客户端当作 server 拉起）。
 *
 * 生命周期刻意挂在 stdio 上：客户端结束进程，这里连带杀掉被托管的二进制，
 * 不需要另一套常驻服务管理。端口每次启动现分配，因此不会写进 mcp.json。
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { applyBridgePort, parseHttpMcpBridgeSpec } from "./mcp/http-bridge/bridge-spec.js";
import { HttpMcpProxy } from "./mcp/http-bridge/http-mcp-proxy.js";

const READY_POLL_INTERVAL_MS = 300;

function diagnostic(message: string): void {
	// stdout 是 MCP 通道，任何附加输出都必须走 stderr
	process.stderr.write(`[mcp-http-bridge] ${message}\n`);
}

async function allocatePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				server.close(() => reject(new Error("could not allocate a loopback port")));
				return;
			}
			const { port } = address;
			server.close(() => resolve(port));
		});
	});
}

async function waitForReady(url: string, deadline: number, isAlive: () => boolean): Promise<void> {
	while (Date.now() < deadline) {
		if (!isAlive()) throw new Error("managed MCP service exited before it became ready");
		try {
			// 端点还没起来时是连接错误；起来了无论回什么状态码都算就绪
			await fetch(url, { method: "HEAD" });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
		}
	}
	throw new Error("managed MCP service did not become ready in time");
}

async function main(): Promise<void> {
	const rawSpec = process.argv[2];
	if (!rawSpec) throw new Error("missing bridge spec argument");
	const spec = parseHttpMcpBridgeSpec(rawSpec);
	const port = await allocatePort();
	const resolved = applyBridgePort(spec, port);

	const child = spawn(spec.command, resolved.args, {
		cwd: spec.cwd,
		env: { ...process.env, ...resolved.env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let exited = false;
	child.on("exit", (code, signal) => {
		exited = true;
		diagnostic(`managed service exited code=${code} signal=${signal}`);
		process.exit(code ?? 0);
	});
	child.stdout?.on("data", (data: Buffer) => diagnostic(`service: ${data.toString().trimEnd()}`));
	child.stderr?.on("data", (data: Buffer) => diagnostic(`service: ${data.toString().trimEnd()}`));

	const stop = (): void => {
		if (!exited) child.kill();
	};
	process.on("exit", stop);
	process.on("SIGTERM", () => process.exit(0));
	process.on("SIGINT", () => process.exit(0));

	await waitForReady(resolved.url, Date.now() + spec.readyTimeoutMs, () => !exited);
	diagnostic(`ready at ${resolved.url}`);

	const proxy = new HttpMcpProxy({
		url: resolved.url,
		write: (line) => process.stdout.write(`${line}\n`),
		onDiagnostic: diagnostic,
	});
	process.stdin.setEncoding("utf8");
	// 串行处理：MCP 客户端允许并发请求，但转发保持顺序更容易排查，且这里的吞吐无关紧要
	let queue: Promise<void> = Promise.resolve();
	process.stdin.on("data", (chunk: string) => {
		queue = queue.then(() => proxy.consume(chunk)).catch((error: unknown) => diagnostic(String(error)));
	});
	process.stdin.on("end", () => process.exit(0));
}

main().catch((error: unknown) => {
	diagnostic(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
