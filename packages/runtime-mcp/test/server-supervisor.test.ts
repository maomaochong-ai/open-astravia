import { describe, expect, it } from "vitest";
import {
	McpAuthRequiredError,
	type McpClientHandle,
	type McpConfig,
	type McpConfigSource,
	type McpInitializeParams,
	type McpInitializeResult,
	type McpJsonObject,
	type McpResourceReadResult,
	type McpServerConfig,
	McpServerSupervisor,
	type McpToolCallResult,
	type RuntimeMcpClientFactory,
} from "../src/index.js";

describe("McpServerSupervisor", () => {
	it("owns startup state while isolating server and discovery failures", async () => {
		const source = new MutableConfigSource({
			ready: stdio("ready"),
			broken: stdio("broken"),
			auth: http("auth"),
			disabled: { ...stdio("disabled"), disabled: true },
			toolsFail: stdio("tools-fail"),
		});
		const clients = new FakeClientFactory();
		clients.initializeErrors.set("broken", new Error("startup failed"));
		clients.initializeErrors.set("auth", new McpAuthRequiredError("auth", "https://auth.test/mcp"));
		clients.toolListErrors.add("toolsFail");
		const supervisor = createSupervisor(source, clients.create);

		await supervisor.initialize();

		expect(supervisor.getServerBinding("ready")?.view).toMatchObject({
			status: "ready",
			tools: [{ name: "tool-ready" }],
			resources: [{ name: "ready" }],
		});
		expect(supervisor.getServerBinding("broken")?.view).toMatchObject({
			status: "error",
			error: "startup failed",
		});
		expect(supervisor.getServerBinding("broken")?.client).toBeUndefined();
		expect(supervisor.getServerBinding("auth")?.view.status).toBe("needs_auth");
		expect(supervisor.getServerBinding("auth")?.client).toBeUndefined();
		expect(clients.clients.find((client) => client.name === "broken")?.closed).toBe(true);
		expect(clients.clients.find((client) => client.name === "auth")?.closed).toBe(true);
		expect(supervisor.getServerBinding("disabled")).toBeUndefined();
		expect(supervisor.getServerBinding("toolsFail")?.view).toMatchObject({
			status: "ready",
			tools: [],
			resources: [{ name: "toolsFail" }],
		});
		expect(supervisor.getStats()).toEqual({
			totalServers: 4,
			readyServers: 2,
			errorServers: 1,
			totalTools: 1,
			totalResources: 2,
		});
	});

	it("diff-reconciles file config and retains live state when loading fails", async () => {
		const source = new MutableConfigSource({
			stable: stdio("stable"),
			changed: stdio("changed-v1"),
			removed: stdio("removed"),
		});
		const clients = new FakeClientFactory();
		const supervisor = createSupervisor(source, clients.create);
		await supervisor.initialize();
		const stableClient = supervisor.getServerBinding("stable")?.client;
		const changedClient = supervisor.getServerBinding("changed")?.client;

		source.servers = {
			stable: stdio("stable"),
			changed: stdio("changed-v2"),
			added: stdio("added"),
		};
		source.signature = "files-v2";
		expect(supervisor.hasConfigChanged()).toBe(true);
		expect(await supervisor.reloadIfChanged()).toBe(true);
		expect(supervisor.getServerBinding("stable")?.client).toBe(stableClient);
		expect(supervisor.getServerBinding("changed")?.client).not.toBe(changedClient);
		expect(supervisor.getServerBinding("removed")).toBeUndefined();
		expect(supervisor.getServerBinding("added")?.view.status).toBe("ready");
		expect(await supervisor.reloadIfChanged()).toBe(false);

		source.signature = "files-invalid";
		source.loadError = new Error("invalid config");
		expect(await supervisor.reloadIfChanged()).toBe(false);
		expect(supervisor.getServerBinding("stable")?.client).toBe(stableClient);
	});

	it("overlays and preserves a replaceable dynamic server set", async () => {
		const source = new MutableConfigSource({ stable: stdio("stable") });
		const clients = new FakeClientFactory();
		const supervisor = createSupervisor(source, clients.create);
		await supervisor.initialize();
		const dynamic = new Map<string, McpServerConfig>([["plugin-alpha", stdio("alpha")]]);

		expect(await supervisor.setDynamicServers({ servers: dynamic, signature: "plugins-v1" })).toBe(true);
		const firstClient = supervisor.getServerBinding("plugin-alpha")?.client;
		expect(await supervisor.setDynamicServers({ servers: dynamic, signature: "plugins-v1" })).toBe(false);
		expect(supervisor.getServerBinding("plugin-alpha")?.client).toBe(firstClient);

		await supervisor.reload();
		expect(supervisor.getServerBinding("stable")?.view.status).toBe("ready");
		expect(supervisor.getServerBinding("plugin-alpha")?.view.status).toBe("ready");

		expect(await supervisor.setDynamicServers({ servers: new Map(), signature: "none" })).toBe(true);
		expect(supervisor.getServerBinding("plugin-alpha")).toBeUndefined();
	});

	it("provides explicit lifecycle operations without product auth concerns", async () => {
		const source = new MutableConfigSource({ ready: stdio("ready") });
		const clients = new FakeClientFactory();
		const supervisor = createSupervisor(source, clients.create);
		await supervisor.initialize();

		await supervisor.disableServer("ready");
		expect(supervisor.getServerBinding("ready")?.view).toMatchObject({
			status: "stopped",
			config: { disabled: true },
		});
		await supervisor.enableServer("ready");
		expect(supervisor.getServerBinding("ready")?.view).toMatchObject({
			status: "ready",
			config: { disabled: false },
		});

		await supervisor.disconnectServer("ready", {
			status: "needs_auth",
			error: "credentials cleared",
		});
		expect(supervisor.getServerBinding("ready")).toMatchObject({
			view: { status: "needs_auth", tools: [], resources: [], error: "credentials cleared" },
			client: undefined,
		});
		await supervisor.restartServer("ready", stdio("ready"));
		expect(supervisor.getServerBinding("ready")?.view.status).toBe("ready");
		await supervisor.shutdown();
		expect(supervisor.getState().servers).toEqual([]);
	});
});

class MutableConfigSource implements McpConfigSource {
	signature = "files-v1";
	loadError: Error | undefined;

	constructor(public servers: Record<string, McpServerConfig>) {}

	loadGlobal(): McpConfig | null {
		return null;
	}

	loadProject(): McpConfig | null {
		return { mcpServers: this.servers };
	}

	loadMerged(): McpConfig {
		if (this.loadError) throw this.loadError;
		return { mcpServers: this.servers };
	}

	getMergedSignature(): string {
		return this.signature;
	}

	getConfigPaths(): { readonly global: string; readonly project: string } {
		return { global: "global.json", project: "project.json" };
	}
}

class FakeClientFactory {
	readonly initializeErrors = new Map<string, Error>();
	readonly toolListErrors = new Set<string>();
	readonly resourceListErrors = new Set<string>();
	readonly clients: FakeClient[] = [];

	readonly create: RuntimeMcpClientFactory = (name) => {
		const client = new FakeClient(
			name,
			this.initializeErrors.get(name),
			this.toolListErrors.has(name),
			this.resourceListErrors.has(name),
		);
		this.clients.push(client);
		return client;
	};
}

class FakeClient implements McpClientHandle {
	private initialized = false;
	closed = false;

	constructor(
		readonly name: string,
		private readonly initializeError?: Error,
		private readonly toolListError = false,
		private readonly resourceListError = false,
	) {}

	async initialize(_params: McpInitializeParams): Promise<McpInitializeResult> {
		if (this.initializeError) throw this.initializeError;
		this.initialized = true;
		return {
			protocolVersion: "test",
			serverInfo: { name: this.name, version: "1" },
			capabilities: { tools: {}, resources: {} },
		};
	}

	async listTools() {
		if (this.toolListError) throw new Error("tool discovery failed");
		return { tools: [{ name: `tool-${this.name}`, inputSchema: { type: "object" as const } }] };
	}

	async callTool(_name: string, _args?: McpJsonObject): Promise<McpToolCallResult> {
		return { content: [] };
	}

	async listResources() {
		if (this.resourceListError) throw new Error("resource discovery failed");
		return { resources: [{ uri: `test://${this.name}`, name: this.name }] };
	}

	async readResource(_uri: string): Promise<McpResourceReadResult> {
		return { contents: [] };
	}

	async listPrompts() {
		return { prompts: [] };
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	getName(): string {
		return this.name;
	}

	getPid(): number | undefined {
		return 123;
	}

	isClientInitialized(): boolean {
		return this.initialized;
	}
}

function createSupervisor(source: McpConfigSource, clientFactory: RuntimeMcpClientFactory) {
	return new McpServerSupervisor({
		configSource: source,
		clientFactory,
		protocolVersion: "test",
		clientInfo: { name: "runtime-test", version: "1" },
	});
}

function stdio(command: string): McpServerConfig {
	return { command };
}

function http(name: string): McpServerConfig {
	return { type: "http", url: `https://${name}.test/mcp` };
}
