import { McpInputRequiredError, McpTaskCreatedError } from "@vetta/runtime-mcp/client";
import { MCP_MODERN_PROTOCOL_VERSION } from "@vetta/runtime-mcp/protocol";
import { describe, expect, it } from "vitest";
import { ModernStatelessMcpClient } from "../../src/mcp/transports/http/modern-stateless-mcp-client.js";

describe("ModernStatelessMcpClient", () => {
	it("uses request-scoped metadata and standard routing headers", async () => {
		const requests: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
		const responses = [
			{
				resultType: "complete",
				supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
				capabilities: { tools: {}, resources: {} },
				ttlMs: 10_000,
				cacheScope: "private",
				_meta: { "io.modelcontextprotocol/serverInfo": { name: "fixture", version: "2.0.0" } },
			},
			{ resultType: "complete", tools: [], ttlMs: 10_000, cacheScope: "private" },
			{
				resultType: "complete",
				content: [
					{ type: "text", text: "ok" },
					{ type: "image", data: "base64", mimeType: "image/png" },
				],
			},
		];
		const client = new ModernStatelessMcpClient({
			config: { type: "http", url: "https://mcp.example.test" },
			name: "fixture",
			clientInfo: { name: "vetta", version: "1.0.0" },
			fetch: async (_input, init) => {
				requests.push({
					body: JSON.parse(String(init?.body)) as Record<string, unknown>,
					headers: new Headers(init?.headers),
				});
				const result = responses.shift();
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		const initialized = await client.initialize({
			protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
			clientInfo: { name: "vetta", version: "1.0.0" },
		});
		await client.listTools();
		const result = await client.callTool("render_preview");

		expect(initialized.serverInfo).toMatchObject({ name: "fixture", version: "2.0.0" });
		expect(requests).toHaveLength(3);
		expect(requests[0].headers.get("MCP-Protocol-Version")).toBe(MCP_MODERN_PROTOCOL_VERSION);
		expect(requests[0].headers.get("Mcp-Method")).toBe("server/discover");
		expect(requests[1].headers.get("Mcp-Method")).toBe("tools/list");
		expect(requests[2].headers.get("Mcp-Method")).toBe("tools/call");
		expect(requests[2].headers.get("Mcp-Name")).toBe("render_preview");
		expect((requests[2].body.params as Record<string, unknown>)._meta).toMatchObject({
			"io.modelcontextprotocol/protocolVersion": MCP_MODERN_PROTOCOL_VERSION,
			"io.modelcontextprotocol/clientCapabilities": {
				extensions: { "io.modelcontextprotocol/tasks": {} },
			},
		});
		expect(result.content).toHaveLength(2);
	});

	it("encodes unsafe MCP names and exposes polymorphic modern results", async () => {
		const responses = [
			{
				resultType: "complete",
				supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
				capabilities: {},
				ttlMs: 0,
				cacheScope: "private",
			},
			{
				resultType: "input_required",
				requestState: "state-1",
				inputRequests: { confirm: { method: "elicitation/create", params: {} } },
			},
			{
				resultType: "task",
				taskId: "task-1",
				status: "working",
				createdAt: "2026-08-29T00:00:00Z",
				lastUpdatedAt: "2026-08-29T00:00:00Z",
				ttlMs: null,
			},
		];
		const headers: Headers[] = [];
		const client = new ModernStatelessMcpClient({
			config: { type: "http", url: "https://mcp.example.test" },
			name: "fixture",
			fetch: async (_input, init) => {
				headers.push(new Headers(init?.headers));
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: responses.shift() }), {
					headers: { "content-type": "application/json" },
				});
			},
		});
		await client.initialize({
			protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
			clientInfo: { name: "vetta", version: "1.0.0" },
		});
		await expect(client.callTool("需要确认")).rejects.toBeInstanceOf(McpInputRequiredError);
		await expect(client.callTool("queued")).rejects.toBeInstanceOf(McpTaskCreatedError);
		expect(headers[1].get("Mcp-Name")).toMatch(/^=\?base64\?/);
	});

	it("resolves InputRequiredResult through host-owned interaction handlers", async () => {
		const requests: Array<Record<string, unknown>> = [];
		const responses = [
			{
				resultType: "complete",
				supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
				capabilities: {},
				ttlMs: 0,
				cacheScope: "private",
			},
			{
				resultType: "input_required",
				requestState: "state-2",
				inputRequests: {
					task: { method: "sampling/createMessage", params: { messages: [], maxTokens: 8 } },
					consent: {
						method: "elicitation/create",
						params: { message: "continue?", requestedSchema: { type: "object", properties: {} } },
					},
					workspace: { method: "roots/list", params: {} },
				},
			},
			{ resultType: "complete", content: [{ type: "text", text: "resumed" }] },
		];
		const client = new ModernStatelessMcpClient({
			config: { type: "http", url: "https://mcp.example.test" },
			name: "fixture",
			interactionHandlers: {
				sampling: async () => ({ role: "assistant", content: { type: "text", text: "ok" }, model: "test" }),
				elicitation: async () => ({ action: "accept" }),
				roots: async () => ({ roots: [{ uri: "file:///workspace", name: "Workspace" }] }),
			},
			fetch: async (_input, init) => {
				requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: requests.length, result: responses.shift() }), {
					headers: { "content-type": "application/json" },
				});
			},
		});
		await client.initialize({
			protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
			clientInfo: { name: "vetta", version: "1" },
		});
		const result = await client.callTool("interactive");
		const resumed = requests[2].params as Record<string, unknown>;
		expect(result.content[0]).toMatchObject({ text: "resumed" });
		expect(resumed.inputResponses).toMatchObject({
			task: { model: "test" },
			consent: { action: "accept" },
			workspace: { roots: [{ uri: "file:///workspace" }] },
		});
		expect(resumed.requestState).toBe("state-2");
	});

	it("supports durable task query/update/cancel methods", async () => {
		const methods: string[] = [];
		const task = {
			resultType: "complete",
			taskId: "task-1",
			status: "completed",
			createdAt: "2026-08-29T00:00:00Z",
			lastUpdatedAt: "2026-08-29T00:00:01Z",
			ttlMs: null,
		};
		const responses = [
			{
				resultType: "complete",
				supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
				capabilities: {},
				ttlMs: 0,
				cacheScope: "private",
			},
			task,
			{ resultType: "complete" },
			{ resultType: "complete" },
		];
		const client = new ModernStatelessMcpClient({
			config: { type: "http", url: "https://mcp.example.test" },
			name: "fixture",
			fetch: async (_input, init) => {
				const request = JSON.parse(String(init?.body)) as { method: string };
				methods.push(request.method);
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: methods.length, result: responses.shift() }), {
					headers: { "content-type": "application/json" },
				});
			},
		});
		await client.initialize({
			protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
			clientInfo: { name: "vetta", version: "1" },
		});
		await expect(client.getTask({ taskId: "task-1" })).resolves.toMatchObject({ status: "completed" });
		await expect(client.updateTask({ taskId: "task-1", inputResponses: {} })).resolves.toMatchObject({
			resultType: "complete",
		});
		await expect(client.cancelTask({ taskId: "task-1" })).resolves.toMatchObject({ resultType: "complete" });
		expect(methods).toEqual(["server/discover", "tasks/get", "tasks/update", "tasks/cancel"]);
	});

	it("caches cacheable results and partitions private entries by authorization context", async () => {
		let token = "one";
		let listRequests = 0;
		const client = new ModernStatelessMcpClient({
			config: {
				type: "http",
				url: "https://mcp.example.test",
				resolveHeaders: () => ({ Authorization: `Bearer ${token}` }),
			},
			name: "fixture",
			fetch: async (_input, init) => {
				const request = JSON.parse(String(init?.body)) as { method: string };
				const result =
					request.method === "server/discover"
						? {
								resultType: "complete",
								supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
								capabilities: { tools: {} },
								ttlMs: 0,
								cacheScope: "private",
							}
						: {
								resultType: "complete",
								tools: [{ name: `tool-${++listRequests}`, inputSchema: { type: "object" } }],
								ttlMs: 60_000,
								cacheScope: "private",
							};
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
					headers: { "content-type": "application/json" },
				});
			},
		});
		await client.initialize({
			protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
			clientInfo: { name: "vetta", version: "1" },
		});

		expect((await client.listTools()).tools[0]?.name).toBe("tool-1");
		expect((await client.listTools()).tools[0]?.name).toBe("tool-1");
		token = "two";
		expect((await client.listTools()).tools[0]?.name).toBe("tool-2");
		expect((await client.listTools(undefined, { forceRefresh: true })).tools[0]?.name).toBe("tool-3");
		expect(listRequests).toBe(3);
	});

	it("runs MRTR for resource and prompt requests", async () => {
		const methods: string[] = [];
		const responses = [
			{
				resultType: "complete",
				supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
				capabilities: { resources: {}, prompts: {} },
				ttlMs: 0,
				cacheScope: "private",
			},
			{
				resultType: "input_required",
				requestState: "resource-state",
				inputRequests: {
					consent: {
						method: "elicitation/create",
						params: { message: "read?", requestedSchema: { type: "object", properties: {} } },
					},
				},
			},
			{
				resultType: "complete",
				contents: [{ uri: "fixture://doc", text: "ok" }],
				ttlMs: 0,
				cacheScope: "private",
			},
			{ resultType: "input_required", requestState: "prompt-state" },
			{
				resultType: "complete",
				messages: [{ role: "user", content: { type: "text", text: "review" } }],
			},
		];
		const client = new ModernStatelessMcpClient({
			config: { type: "http", url: "https://mcp.example.test" },
			name: "fixture",
			interactionHandlers: { elicitation: async () => ({ action: "accept" }) },
			fetch: async (_input, init) => {
				methods.push((JSON.parse(String(init?.body)) as { method: string }).method);
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: responses.shift() }), {
					headers: { "content-type": "application/json" },
				});
			},
		});
		await client.initialize({
			protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
			clientInfo: { name: "vetta", version: "1" },
		});
		await expect(client.readResource("fixture://doc")).resolves.toMatchObject({ contents: [{ text: "ok" }] });
		await expect(client.getPrompt({ name: "review" })).resolves.toMatchObject({ messages: [{ role: "user" }] });
		expect(methods).toEqual(["server/discover", "resources/read", "resources/read", "prompts/get", "prompts/get"]);
	});

	it("validates subscription acknowledgement before delivering stream notifications", async () => {
		const delivered: string[] = [];
		const client = new ModernStatelessMcpClient({
			config: { type: "http", url: "https://mcp.example.test" },
			name: "fixture",
			fetch: async (_input, init) => {
				const request = JSON.parse(String(init?.body)) as { id: string; method: string };
				if (request.method === "server/discover") {
					return new Response(
						JSON.stringify({
							jsonrpc: "2.0",
							id: request.id,
							result: {
								resultType: "complete",
								supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
								capabilities: {},
								ttlMs: 0,
								cacheScope: "public",
							},
						}),
						{ headers: { "content-type": "application/json" } },
					);
				}
				const meta = { "io.modelcontextprotocol/subscriptionId": request.id };
				const events = [
					{
						jsonrpc: "2.0",
						method: "notifications/subscriptions/acknowledged",
						params: { _meta: meta, notifications: { toolsListChanged: true } },
					},
					{ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { _meta: meta } },
					{ jsonrpc: "2.0", id: request.id, result: { resultType: "complete", _meta: meta } },
				];
				return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
					headers: { "content-type": "text/event-stream" },
				});
			},
		});
		await client.initialize({
			protocolVersion: MCP_MODERN_PROTOCOL_VERSION,
			clientInfo: { name: "vetta", version: "1" },
		});
		await expect(
			client.listenSubscriptions({ toolsListChanged: true }, (notification) => {
				delivered.push(notification.method);
			}),
		).resolves.toMatchObject({ resultType: "complete" });
		expect(delivered).toEqual(["notifications/subscriptions/acknowledged", "notifications/tools/list_changed"]);
	});
});
