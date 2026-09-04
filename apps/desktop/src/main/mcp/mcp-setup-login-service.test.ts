import type { McpToolCallResult } from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import { McpSetupLoginService, readSetupLoginQrCode } from "./mcp-setup-login-service";

const PNG = "iVBORw0KGgo=";

function result(overrides: Partial<McpToolCallResult>): McpToolCallResult {
	return { content: [], ...overrides };
}

describe("readSetupLoginQrCode", () => {
	it("reads an image content block", () => {
		expect(readSetupLoginQrCode(result({ content: [{ type: "image", data: PNG, mimeType: "image/png" }] }))).toEqual({
			image: `data:image/png;base64,${PNG}`,
			expiresInSeconds: 180,
		});
	});

	it("reads base64 and timeout from structured content", () => {
		expect(readSetupLoginQrCode(result({ structuredContent: { img: PNG, timeout: 240 } }))).toEqual({
			image: `data:image/png;base64,${PNG}`,
			expiresInSeconds: 240,
		});
	});

	it("reads a JSON text payload", () => {
		expect(
			readSetupLoginQrCode(
				result({ content: [{ type: "text", text: JSON.stringify({ qrcode: PNG, timeout_seconds: "60" }) }] }),
			),
		).toEqual({ image: `data:image/png;base64,${PNG}`, expiresInSeconds: 60 });
	});

	it("keeps an already-formed data URL", () => {
		const url = `data:image/png;base64,${PNG}`;
		expect(readSetupLoginQrCode(result({ content: [{ type: "text", text: url }] })).image).toBe(url);
	});

	it("surfaces the tool error text", () => {
		expect(() =>
			readSetupLoginQrCode(result({ isError: true, content: [{ type: "text", text: "already logged in" }] })),
		).toThrow(/already logged in/);
	});

	it("rejects a result without any image", () => {
		expect(() => readSetupLoginQrCode(result({ content: [{ type: "text", text: "ok" }] }))).toThrow(/QR code image/);
	});
});

function fakeClient(callTool: () => Promise<McpToolCallResult>) {
	const close = vi.fn(async () => undefined);
	// 真实客户端在 initialize 之前 callTool 会抛「MCP client is not initialized」
	let initialized = false;
	const initialize = vi.fn(async () => {
		initialized = true;
		return { protocolVersion: "2025-06-18", serverInfo: { name: "demo", version: "1" }, capabilities: {} };
	});
	const handle = {
		initialize,
		callTool: vi.fn(async () => {
			if (!initialized) throw new Error("MCP client is not initialized");
			return callTool();
		}),
		close,
	};
	return { handle: handle as never, close, initialize };
}

describe("McpSetupLoginService", () => {
	const stdio = { command: "/runtime/demo", args: ["-transport=stdio"] } as never;

	it("calls the declared tool on the configured server", async () => {
		const { handle, close, initialize } = fakeClient(async () =>
			result({ content: [{ type: "image", data: PNG, mimeType: "image/png" }] }),
		);
		const clientFactory = vi.fn(() => handle);
		const service = new McpSetupLoginService({
			loadServerConfig: async () => stdio,
			clientFactory: clientFactory as never,
		});

		await expect(service.start("demo-mcp", "get_login_qrcode")).resolves.toMatchObject({
			image: `data:image/png;base64,${PNG}`,
		});
		expect(clientFactory).toHaveBeenCalledWith("demo-mcp", stdio, expect.anything());
		expect(initialize).toHaveBeenCalledTimes(1);
		// 会话保持到 cancel：受管服务要在同一连接里等扫码结果
		expect(close).not.toHaveBeenCalled();

		await service.cancel();
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("closes the session when the tool call fails", async () => {
		const { handle, close } = fakeClient(async () => {
			throw new Error("spawn failed");
		});
		const service = new McpSetupLoginService({
			loadServerConfig: async () => stdio,
			clientFactory: (() => handle) as never,
		});

		await expect(service.start("demo-mcp", "get_login_qrcode")).rejects.toThrow(/spawn failed/);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("refuses servers that are not configured or not stdio", async () => {
		const service = new McpSetupLoginService({
			loadServerConfig: async (name) =>
				name === "http-mcp" ? ({ type: "http", url: "https://example.com/mcp" } as never) : undefined,
			clientFactory: (() => {
				throw new Error("must not connect");
			}) as never,
		});

		await expect(service.start("missing", "tool")).rejects.toThrow(/not configured/);
		await expect(service.start("http-mcp", "tool")).rejects.toThrow(/stdio/);
	});
});
