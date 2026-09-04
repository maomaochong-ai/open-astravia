import { describe, expect, it, vi } from "vitest";
import { applyBridgePort, parseHttpMcpBridgeSpec } from "./bridge-spec";
import { HttpMcpProxy, readSseMessages } from "./http-mcp-proxy";

const URL_ = "http://127.0.0.1:18060/mcp";
const PORT = `\${VETTA_MCP_PORT}`;

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json", ...headers },
	});
}

describe("bridge spec", () => {
	it("按分配到的端口替换参数与环境变量，并拼出端点", () => {
		const spec = parseHttpMcpBridgeSpec(
			JSON.stringify({
				schemaVersion: 1,
				command: "/runtime/demo",
				args: [`-port=:${PORT}`],
				env: { SELF_URL: `http://127.0.0.1:${PORT}` },
				path: "/mcp",
			}),
		);

		expect(applyBridgePort(spec, 41234)).toEqual({
			args: ["-port=:41234"],
			env: { SELF_URL: "http://127.0.0.1:41234" },
			url: "http://127.0.0.1:41234/mcp",
		});
		expect(spec.readyTimeoutMs).toBe(120_000);
	});

	it("拒绝残缺的 spec", () => {
		expect(() => parseHttpMcpBridgeSpec(JSON.stringify({ schemaVersion: 2 }))).toThrow(/schemaVersion/);
		expect(() => parseHttpMcpBridgeSpec(JSON.stringify({ schemaVersion: 1, path: "/mcp" }))).toThrow(/command/);
	});
});

describe("readSseMessages", () => {
	it("拼接多行 data 帧", () => {
		expect(readSseMessages('event: message\ndata: {"a":\ndata: 1}\n\ndata: {"b":2}\n\n')).toEqual([
			'{"a":1}',
			'{"b":2}',
		]);
	});
});

describe("HttpMcpProxy", () => {
	it("逐条转发换行分隔的 JSON-RPC，并把响应写回 stdout", async () => {
		const write = vi.fn();
		const fetchImpl = vi.fn(async () => jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }));
		const proxy = new HttpMcpProxy({ url: URL_, fetchImpl: fetchImpl as never, write });

		await proxy.consume('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"metho');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":1,"result":{}}');

		// 半条消息要等到下一块补齐才发出
		await proxy.consume('d":"tools/list"}\n');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("记住 initialize 返回的会话 id 并在后续请求带上", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "s-1" }))
			.mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 2, result: {} }));
		const proxy = new HttpMcpProxy({ url: URL_, fetchImpl: fetchImpl as never, write: vi.fn() });

		await proxy.consume('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
		await proxy.consume('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');

		const headers = (fetchImpl.mock.calls[1]?.[1] as { headers: Record<string, string> }).headers;
		expect(headers["mcp-session-id"]).toBe("s-1");
	});

	it("展开 SSE 响应里的每条消息", async () => {
		const write = vi.fn();
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":3}\n\n',
					{
						status: 200,
						headers: { "content-type": "text/event-stream" },
					},
				),
		);
		const proxy = new HttpMcpProxy({ url: URL_, fetchImpl: fetchImpl as never, write });

		await proxy.consume('{"jsonrpc":"2.0","id":3,"method":"tools/call"}\n');
		expect(write).toHaveBeenNthCalledWith(1, '{"jsonrpc":"2.0","method":"notifications/progress"}');
		expect(write).toHaveBeenNthCalledWith(2, '{"jsonrpc":"2.0","id":3}');
	});

	it("通知的 202 响应不产生输出", async () => {
		const write = vi.fn();
		const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
		const proxy = new HttpMcpProxy({ url: URL_, fetchImpl: fetchImpl as never, write });

		await proxy.consume('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
		expect(write).not.toHaveBeenCalled();
	});

	it("传输失败时回一条 JSON-RPC 错误，避免客户端干等", async () => {
		const write = vi.fn();
		const fetchImpl = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		const proxy = new HttpMcpProxy({ url: URL_, fetchImpl: fetchImpl as never, write });

		await proxy.consume('{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n');
		expect(JSON.parse(write.mock.calls[0]?.[0] as string)).toMatchObject({
			id: 7,
			error: { code: -32000 },
		});

		write.mockClear();
		await proxy.consume('{"jsonrpc":"2.0","method":"notifications/cancelled"}\n');
		expect(write).not.toHaveBeenCalled();
	});
});
