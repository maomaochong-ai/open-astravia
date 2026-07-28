/**
 * 钉死「按请求解析 header」这条链路真的接到了 transport 上。
 *
 * 单测 buildBuiltinMcpServers 只能证明配置里带了 resolveHeaders；这里起一个真的
 * HTTP server，验证 token 轮换后**后续请求**确实带上了新 token——静态 headers
 * 的写法能通过前者却过不了这里，而线上表现正是「用几天后工具突然消失」。
 */

import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpMcpClient } from "../src/core/mcp/mcp-http-client.js";
import type { McpHttpServerConfig } from "../src/core/mcp/types.js";

interface RecordedRequest {
	method: string;
	authorization: string | undefined;
	clientVersion: string | undefined;
}

const INIT_PARAMS = {
	protocolVersion: "2024-11-05",
	capabilities: {},
	clientInfo: { name: "test", version: "1.0.0" },
};

describe("HttpMcpClient dynamic headers", () => {
	let server: Server;
	let baseUrl: string;
	let requests: RecordedRequest[];

	beforeEach(async () => {
		requests = [];
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				const message = body ? JSON.parse(body) : {};
				requests.push({
					method: message.method,
					authorization: req.headers.authorization,
					clientVersion: req.headers["x-vetta-client-version"] as string | undefined,
				});

				// notification 无响应
				if (message.id === undefined) {
					res.writeHead(202).end();
					return;
				}

				const result =
					message.method === "initialize"
						? {
								protocolVersion: "2024-11-05",
								capabilities: { tools: { listChanged: false } },
								serverInfo: { name: "vetta", version: "1.0.0" },
							}
						: message.method === "tools/list"
							? { tools: [] }
							: {};

				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
			});
		});

		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (typeof address === "string" || address === null) throw new Error("failed to bind test server");
		baseUrl = `http://127.0.0.1:${address.port}/mcp`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("每次请求都重新解析 Authorization，token 轮换后立即生效", async () => {
		let token = "token-old";
		const config: McpHttpServerConfig = {
			type: "http",
			url: baseUrl,
			resolveHeaders: () => ({ Authorization: `Bearer ${token}` }),
		};
		const client = new HttpMcpClient({ name: "vetta", config });

		await client.initialize(INIT_PARAMS);
		expect(requests.at(-1)?.authorization).toBe("Bearer token-old");

		// 模拟服务端轮换：宿主刷新了凭据，连接本身没有重建
		token = "token-new";
		await client.listTools();

		expect(requests.at(-1)?.authorization).toBe("Bearer token-new");
		await client.close();
	});

	it("静态 headers 与动态 header 同时生效", async () => {
		const config: McpHttpServerConfig = {
			type: "http",
			url: baseUrl,
			headers: { "X-Vetta-Client-Version": "9.9.9" },
			resolveHeaders: () => ({ Authorization: "Bearer t" }),
		};
		const client = new HttpMcpClient({ name: "vetta", config });

		await client.initialize(INIT_PARAMS);

		const last = requests.at(-1);
		expect(last?.clientVersion).toBe("9.9.9");
		expect(last?.authorization).toBe("Bearer t");
		await client.close();
	});

	it("解析器抛错不拖垮请求", async () => {
		// 凭据文件的瞬时读失败应表现为服务端的 401，而不是不透明的传输层崩溃
		const config: McpHttpServerConfig = {
			type: "http",
			url: baseUrl,
			resolveHeaders: () => {
				throw new Error("credential file busy");
			},
		};
		const client = new HttpMcpClient({ name: "vetta", config });

		await expect(client.initialize(INIT_PARAMS)).resolves.toBeDefined();
		expect(requests.at(-1)?.authorization).toBeUndefined();
		await client.close();
	});

	it("没有解析器时走 SDK 默认 fetch", async () => {
		const config: McpHttpServerConfig = { type: "http", url: baseUrl };
		const client = new HttpMcpClient({ name: "vetta", config });

		await expect(client.initialize(INIT_PARAMS)).resolves.toBeDefined();
		await client.close();
	});
});
