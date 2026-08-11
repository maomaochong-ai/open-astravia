import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
	clientOptions: undefined as unknown,
	clientInfo: undefined as unknown,
	transportUrl: undefined as unknown,
	transportOptions: undefined as unknown,
	calls: [] as unknown[][],
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
	UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class Client {
		constructor(clientInfo: unknown, clientOptions: unknown) {
			sdk.clientInfo = clientInfo;
			sdk.clientOptions = clientOptions;
		}

		async connect(transport: unknown, options: unknown): Promise<void> {
			sdk.calls.push(["connect", transport, options]);
		}

		getServerVersion() {
			return { name: "mock-server", version: "1.0.0" };
		}

		getServerCapabilities() {
			return { tools: {} };
		}

		async listTools(params: unknown): Promise<unknown> {
			sdk.calls.push(["listTools", params]);
			return { tools: [] };
		}

		async callTool(params: unknown): Promise<unknown> {
			sdk.calls.push(["callTool", params]);
			return { content: [] };
		}

		async listResources(params: unknown): Promise<unknown> {
			sdk.calls.push(["listResources", params]);
			return { resources: [] };
		}

		async readResource(params: unknown): Promise<unknown> {
			sdk.calls.push(["readResource", params]);
			return { contents: [] };
		}

		async listPrompts(params: unknown): Promise<unknown> {
			sdk.calls.push(["listPrompts", params]);
			return { prompts: [] };
		}

		async close(): Promise<void> {
			sdk.calls.push(["close"]);
		}
	},
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: class StreamableHTTPClientTransport {
		constructor(url: URL, options: unknown) {
			sdk.transportUrl = url;
			sdk.transportOptions = options;
		}
	},
}));

import { createMcpHttpSdkSession } from "../src/transports/http/sdk-session-adapter.js";

describe("MCP HTTP SDK session adapter", () => {
	it("maps transport, client and method inputs to the official SDK", async () => {
		const authProvider = {} as OAuthClientProvider;
		const session = createMcpHttpSdkSession({
			url: new URL("https://example.test/mcp"),
			requestInit: { headers: { Authorization: "Bearer test" } },
			authProvider,
			clientInfo: { name: "client", version: "1.0.0" },
			capabilities: { roots: { listChanged: true } },
			timeout: 4321,
		});

		await session.connect();
		expect(sdk.transportUrl).toEqual(new URL("https://example.test/mcp"));
		expect(sdk.transportOptions).toEqual({
			requestInit: { headers: { Authorization: "Bearer test" } },
			authProvider,
		});
		expect(sdk.clientInfo).toEqual({ name: "client", version: "1.0.0" });
		expect(sdk.clientOptions).toEqual({ capabilities: { roots: { listChanged: true } } });
		expect(session.getServerVersion()).toEqual({ name: "mock-server", version: "1.0.0" });
		expect(session.getServerCapabilities()).toEqual({ tools: {} });

		await session.listTools("tools-cursor");
		await session.callTool("echo", { value: "hello" });
		await session.listResources("resources-cursor");
		await session.readResource("fixture://resource");
		await session.listPrompts("prompts-cursor");
		await session.close();
		expect(sdk.calls).toEqual([
			["connect", expect.anything(), { timeout: 4321 }],
			["listTools", { cursor: "tools-cursor" }],
			["callTool", { name: "echo", arguments: { value: "hello" } }],
			["listResources", { cursor: "resources-cursor" }],
			["readResource", { uri: "fixture://resource" }],
			["listPrompts", { cursor: "prompts-cursor" }],
			["close"],
		]);
	});
});
