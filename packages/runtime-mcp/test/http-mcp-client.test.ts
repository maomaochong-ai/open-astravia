import { describe, expect, it, vi } from "vitest";
import {
	createMcpClient,
	HttpMcpClient,
	McpAuthRequiredError,
	type McpHttpSdkSession,
	type McpHttpSdkSessionOptions,
	StdioMcpClient,
} from "../src/index.js";

const initializeParams = {
	protocolVersion: "2024-11-05",
	clientInfo: { name: "test-client", version: "1.0.0" },
	capabilities: { roots: { listChanged: true } },
};

describe("HTTP MCP client", () => {
	it("maps initialization and MCP methods through the SDK session boundary", async () => {
		const session = new FakeSdkSession();
		let sessionOptions: McpHttpSdkSessionOptions | undefined;
		const authProviderFactory = vi.fn(() => undefined);
		const client = new HttpMcpClient({
			name: "remote",
			config: {
				type: "http",
				url: "https://example.test/mcp",
				headers: { Authorization: "Bearer static" },
			},
			timeout: 1234,
			authProviderFactory,
			sdkSessionFactory: (options) => {
				sessionOptions = options;
				return session;
			},
		});

		await expect(client.initialize(initializeParams)).resolves.toEqual({
			protocolVersion: "2024-11-05",
			serverInfo: {
				name: "sdk-server",
				version: "2.0.0",
				capabilities: { tools: {}, resources: {} },
			},
			capabilities: { tools: {}, resources: {} },
		});
		expect(authProviderFactory).toHaveBeenCalledWith({
			serverName: "remote",
			serverUrl: "https://example.test/mcp",
			config: {
				type: "http",
				url: "https://example.test/mcp",
				headers: { Authorization: "Bearer static" },
			},
		});
		expect(sessionOptions).toMatchObject({
			url: new URL("https://example.test/mcp"),
			requestInit: { headers: { Authorization: "Bearer static" } },
			clientInfo: initializeParams.clientInfo,
			capabilities: initializeParams.capabilities,
			timeout: 1234,
		});
		expect(client.getName()).toBe("remote");
		expect(client.getPid()).toBeUndefined();
		expect(client.isClientInitialized()).toBe(true);

		await expect(client.listTools("tools-cursor")).resolves.toEqual({ tools: [] });
		await expect(client.callTool("echo", { value: "hello" })).resolves.toEqual({ content: [] });
		await expect(client.listResources("resources-cursor")).resolves.toEqual({ resources: [] });
		await expect(client.readResource("fixture://resource")).resolves.toEqual({ contents: [] });
		await expect(client.listPrompts("prompts-cursor")).resolves.toEqual({ prompts: [] });
		expect(session.calls).toEqual([
			["connect"],
			["listTools", "tools-cursor"],
			["callTool", "echo", { value: "hello" }],
			["listResources", "resources-cursor"],
			["readResource", "fixture://resource"],
			["listPrompts", "prompts-cursor"],
		]);
	});

	it("converts unauthorized connection failures and closes the partial session", async () => {
		const session = new FakeSdkSession();
		session.connectError = new Error("401 Unauthorized");
		const client = createHttpClient(session);

		await expect(client.initialize(initializeParams)).rejects.toMatchObject({
			name: "McpAuthRequiredError",
			code: "MCP_AUTH_REQUIRED",
			serverName: "remote",
			serverUrl: "https://example.test/mcp",
		});
		expect(session.closeCalls).toBe(1);
		expect(client.isClientInitialized()).toBe(false);
	});

	it("converts unauthorized tool failures and invalidates the initialized state", async () => {
		const session = new FakeSdkSession();
		const client = createHttpClient(session);
		await client.initialize(initializeParams);
		session.callToolError = new Error("Unauthorized tool request");

		await expect(client.callTool("private")).rejects.toBeInstanceOf(McpAuthRequiredError);
		expect(client.isClientInitialized()).toBe(false);
		await expect(client.listTools()).rejects.toThrow("HTTP MCP client is not initialized");
	});

	it("swallows SDK close failures and clears the client state", async () => {
		const session = new FakeSdkSession();
		const client = createHttpClient(session);
		await client.initialize(initializeParams);
		session.closeError = new Error("close failed");

		await expect(client.close()).resolves.toBeUndefined();
		expect(client.isClientInitialized()).toBe(false);
	});

	it("selects stdio and HTTP clients without a shared low-level transport", () => {
		expect(createMcpClient("local", { command: "node" })).toBeInstanceOf(StdioMcpClient);
		expect(createMcpClient("remote", { type: "http", url: "https://example.test/mcp" })).toBeInstanceOf(
			HttpMcpClient,
		);
	});
});

class FakeSdkSession implements McpHttpSdkSession {
	readonly calls: unknown[][] = [];
	connectError: Error | undefined;
	callToolError: Error | undefined;
	closeError: Error | undefined;
	closeCalls = 0;

	async connect(): Promise<void> {
		this.calls.push(["connect"]);
		if (this.connectError) throw this.connectError;
	}

	getServerVersion(): { name: string; version: string } {
		return { name: "sdk-server", version: "2.0.0" };
	}

	getServerCapabilities() {
		return { tools: {}, resources: {} };
	}

	async listTools(cursor?: string): Promise<unknown> {
		this.calls.push(["listTools", cursor]);
		return { tools: [] };
	}

	async callTool(name: string, args?: Record<string, unknown>): Promise<unknown> {
		this.calls.push(["callTool", name, args]);
		if (this.callToolError) throw this.callToolError;
		return { content: [] };
	}

	async listResources(cursor?: string): Promise<unknown> {
		this.calls.push(["listResources", cursor]);
		return { resources: [] };
	}

	async readResource(uri: string): Promise<unknown> {
		this.calls.push(["readResource", uri]);
		return { contents: [] };
	}

	async listPrompts(cursor?: string): Promise<unknown> {
		this.calls.push(["listPrompts", cursor]);
		return { prompts: [] };
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
		if (this.closeError) throw this.closeError;
	}
}

function createHttpClient(session: McpHttpSdkSession): HttpMcpClient {
	return new HttpMcpClient({
		name: "remote",
		config: { type: "http", url: "https://example.test/mcp" },
		sdkSessionFactory: () => session,
	});
}
