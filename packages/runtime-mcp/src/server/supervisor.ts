import { isMcpAuthRequiredError, type McpClientHandle, type RuntimeMcpClientFactory } from "../client/index.js";
import type { McpConfigSource } from "../config/index.js";
import type {
	McpClientInfo,
	McpConfig,
	McpResource,
	McpServerConfig,
	McpServerInfo,
	McpServerStatus,
	McpTool,
} from "../protocol/index.js";
import type {
	McpDynamicServerSet,
	McpServerBinding,
	McpServerDisconnectOutcome,
	McpServerSupervisorState,
	McpServerSupervisorStats,
	McpServerView,
} from "./contracts.js";

interface ManagedMcpServer {
	name: string;
	config: McpServerConfig;
	status: McpServerStatus;
	serverInfo?: McpServerInfo;
	client?: McpClientHandle;
	tools: McpTool[];
	resources: McpResource[];
	error?: string;
	pid?: number;
	startedAt?: number;
}

export interface McpServerSupervisorOptions {
	readonly configSource: McpConfigSource;
	readonly clientFactory: RuntimeMcpClientFactory;
	readonly protocolVersion: string;
	readonly clientInfo: McpClientInfo;
	readonly enabled?: boolean;
	readonly debug?: boolean;
	readonly onDiagnostic?: (message: string) => void;
	readonly authRequiredErrorMatcher?: (error: unknown) => boolean;
	/** Product-owned defaults. File config may override the same name. */
	readonly builtinServers?: Readonly<Record<string, McpServerConfig>>;
}

/**
 * Owns MCP server lifecycle and file/dynamic config reconciliation.
 * Product-specific auth UX and tool adaptation remain in host adapters.
 */
export class McpServerSupervisor {
	private readonly servers = new Map<string, ManagedMcpServer>();
	private readonly configSource: McpConfigSource;
	private readonly clientFactory: RuntimeMcpClientFactory;
	private readonly protocolVersion: string;
	private readonly clientInfo: McpClientInfo;
	private readonly debug: boolean;
	private readonly onDiagnostic?: (message: string) => void;
	private readonly authRequiredErrorMatcher: (error: unknown) => boolean;
	private enabled: boolean;
	private readonly builtinServers = new Map<string, McpServerConfig>();
	private dynamicServers = new Map<string, McpServerConfig>();
	private dynamicSignature = "none";
	private lastSignature: string | undefined;
	private globalConfig: McpConfig | undefined;
	private projectConfig: McpConfig | undefined;

	constructor(options: McpServerSupervisorOptions) {
		this.configSource = options.configSource;
		this.clientFactory = options.clientFactory;
		this.protocolVersion = options.protocolVersion;
		this.clientInfo = options.clientInfo;
		this.enabled = options.enabled ?? true;
		this.debug = options.debug ?? false;
		this.onDiagnostic = options.onDiagnostic;
		this.authRequiredErrorMatcher = options.authRequiredErrorMatcher ?? isMcpAuthRequiredError;
		for (const [name, config] of Object.entries(options.builtinServers ?? {})) {
			if (name && !name.includes("_")) this.builtinServers.set(name, config);
		}
	}

	async initialize(): Promise<void> {
		if (!this.enabled) {
			this.log("MCP is disabled, skipping initialization");
			return;
		}

		try {
			this.globalConfig = this.configSource.loadGlobal() ?? undefined;
			this.projectConfig = this.configSource.loadProject() ?? undefined;
			const config = this.loadEffectiveConfig();
			const starts: Promise<void>[] = [];
			for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
				if (serverConfig.disabled) {
					this.log(`Skipping disabled server: ${name}`);
					continue;
				}
				starts.push(this.startServer(name, serverConfig));
			}
			await Promise.allSettled(starts);
			this.lastSignature = this.combinedSignature();
			this.log(`Initialized ${this.servers.size} MCP servers`);
		} catch (error) {
			this.log(`Failed to initialize MCP servers: ${getErrorMessage(error)}`);
			throw error;
		}
	}

	async setDynamicServers(next: McpDynamicServerSet): Promise<boolean> {
		if (!this.enabled) {
			this.dynamicServers.clear();
			this.dynamicSignature = "none";
			return false;
		}
		if (next.signature === this.dynamicSignature && mapsEqualConfig(this.dynamicServers, next.servers)) {
			return false;
		}
		this.dynamicServers = new Map(next.servers);
		this.dynamicSignature = next.signature;
		return this.reconcileToEffectiveConfig();
	}

	hasConfigChanged(): boolean {
		if (!this.enabled) return false;
		return this.lastSignature !== this.combinedSignature();
	}

	async reloadIfChanged(): Promise<boolean> {
		if (!this.enabled) return false;
		const signature = this.combinedSignature();
		if (this.lastSignature !== undefined && this.lastSignature === signature) return false;
		this.log("MCP config changed, diff-reloading");
		return this.reconcileToEffectiveConfig();
	}

	async reload(): Promise<void> {
		this.log("Reloading MCP configuration");
		await this.shutdown();
		this.lastSignature = undefined;
		await this.initialize();
	}

	async restartServer(name: string, config: McpServerConfig): Promise<void> {
		const current = this.servers.get(name);
		if (current?.client) {
			try {
				await current.client.close();
			} catch {
				// Reconnect must still proceed when closing a stale client fails.
			}
		}
		this.servers.delete(name);
		if (!config.disabled) await this.startServer(name, config);
	}

	async disconnectServer(name: string, outcome: McpServerDisconnectOutcome): Promise<void> {
		const server = this.servers.get(name);
		if (!server) return;
		if (server.client) {
			try {
				await server.client.close();
			} catch {
				// State still needs to reflect the explicit disconnect operation.
			}
		}
		server.client = undefined;
		server.tools = [];
		server.resources = [];
		server.serverInfo = undefined;
		server.status = outcome.status;
		if (outcome.error !== undefined) server.error = outcome.error;
	}

	async enableServer(name: string): Promise<void> {
		const server = this.servers.get(name);
		if (!server) throw new Error(`Server '${name}' not found`);
		if (server.status === "ready") {
			this.log(`Server ${name} is already enabled`);
			return;
		}
		server.config.disabled = false;
		await this.startServer(name, server.config);
	}

	async disableServer(name: string): Promise<void> {
		const server = this.servers.get(name);
		if (!server) throw new Error(`Server '${name}' not found`);
		server.config.disabled = true;
		if (server.client) await server.client.close();
		server.status = "stopped";
		server.client = undefined;
		this.log(`Server ${name} disabled`);
	}

	async shutdown(): Promise<void> {
		this.log("Shutting down all MCP servers");
		const closes: Promise<void>[] = [];
		for (const server of this.servers.values()) {
			if (!server.client) continue;
			closes.push(
				server.client.close().catch((error) => {
					this.log(`Error closing server ${server.name}: ${getErrorMessage(error)}`);
				}),
			);
		}
		await Promise.allSettled(closes);
		this.servers.clear();
		this.log("All MCP servers shut down");
	}

	getServerBinding(name: string): McpServerBinding | undefined {
		const server = this.servers.get(name);
		return server ? toBinding(server) : undefined;
	}

	getServerBindings(): McpServerBinding[] {
		return [...this.servers.values()].map(toBinding);
	}

	getReadyServerBindings(): McpServerBinding[] {
		return [...this.servers.values()]
			.filter((server) => server.status === "ready" && server.client !== undefined)
			.map(toBinding);
	}

	getState(): McpServerSupervisorState {
		return {
			enabled: this.enabled,
			servers: [...this.servers.values()].map(toView),
			globalConfig: this.globalConfig,
			projectConfig: this.projectConfig,
		};
	}

	getStats(): McpServerSupervisorStats {
		let readyServers = 0;
		let errorServers = 0;
		let totalTools = 0;
		let totalResources = 0;
		for (const server of this.servers.values()) {
			if (server.status === "ready") {
				readyServers++;
				totalTools += server.tools.length;
				totalResources += server.resources.length;
			} else if (server.status === "error") {
				errorServers++;
			}
		}
		return {
			totalServers: this.servers.size,
			readyServers,
			errorServers,
			totalTools,
			totalResources,
		};
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	getConfigPaths(): { readonly global: string; readonly project: string } {
		return this.configSource.getConfigPaths();
	}

	private loadEffectiveConfig(): McpConfig {
		const merged = this.configSource.loadMerged();
		const mcpServers: Record<string, McpServerConfig> = Object.fromEntries(this.builtinServers);
		Object.assign(mcpServers, merged.mcpServers);
		for (const [name, config] of this.dynamicServers) mcpServers[name] = config;
		return { mcpServers };
	}

	private combinedSignature(): string {
		return `${this.configSource.getMergedSignature()}|dynamic:${this.dynamicSignature}`;
	}

	private async startServer(name: string, config: McpServerConfig): Promise<void> {
		this.log(`Initializing server: ${name}`);
		const server: ManagedMcpServer = {
			name,
			config,
			status: "starting",
			tools: [],
			resources: [],
		};
		this.servers.set(name, server);

		try {
			const client = this.clientFactory(name, config, { debug: this.debug || config.debug });
			server.client = client;
			server.startedAt = Date.now();
			const result = await client.initialize({
				protocolVersion: this.protocolVersion,
				clientInfo: this.clientInfo,
				capabilities: {},
			});
			server.serverInfo = result.serverInfo;
			server.pid = client.getPid();

			if (result.capabilities?.tools) {
				try {
					server.tools = (await client.listTools()).tools;
					this.log(`Server ${name} provides ${server.tools.length} tools`);
				} catch (error) {
					this.log(`Failed to list tools for ${name}: ${getErrorMessage(error)}`);
				}
			}
			if (result.capabilities?.resources) {
				try {
					server.resources = (await client.listResources()).resources;
					this.log(`Server ${name} provides ${server.resources.length} resources`);
				} catch (error) {
					this.log(`Failed to list resources for ${name}: ${getErrorMessage(error)}`);
				}
			}

			server.status = "ready";
			server.error = undefined;
			this.log(`Server ${name} is ready`);
		} catch (error) {
			const failedClient = server.client;
			if (failedClient) {
				try {
					await failedClient.close();
				} catch (closeError) {
					this.log(`Error closing failed server ${name}: ${getErrorMessage(closeError)}`);
				}
				server.client = undefined;
			}
			if (this.authRequiredErrorMatcher(error)) {
				server.status = "needs_auth";
				server.error = getErrorMessage(error);
				this.log(`Server ${name} needs OAuth authorization`);
				return;
			}
			server.status = "error";
			server.error = getErrorMessage(error);
			this.log(`Failed to initialize server ${name}: ${server.error}`);
		}
	}

	private async reconcileToEffectiveConfig(): Promise<boolean> {
		let config: McpConfig;
		try {
			config = this.loadEffectiveConfig();
		} catch (error) {
			this.log(`Failed to load effective MCP config, keeping current state: ${getErrorMessage(error)}`);
			this.lastSignature = this.combinedSignature();
			return false;
		}

		const nextNames = new Set(Object.keys(config.mcpServers));
		let changed = false;
		for (const [name, server] of [...this.servers]) {
			if (nextNames.has(name)) continue;
			if (server.client) {
				try {
					await server.client.close();
				} catch (error) {
					this.log(`Error closing removed server ${name}: ${getErrorMessage(error)}`);
				}
			}
			this.servers.delete(name);
			this.log(`Removed server: ${name}`);
			changed = true;
		}

		const starts: Promise<void>[] = [];
		for (const [name, nextConfig] of Object.entries(config.mcpServers)) {
			const current = this.servers.get(name);
			if (!current) {
				if (!nextConfig.disabled) {
					starts.push(this.startServer(name, nextConfig));
					changed = true;
				}
				continue;
			}
			if (JSON.stringify(current.config) === JSON.stringify(nextConfig)) continue;
			if (current.client) {
				try {
					await current.client.close();
				} catch (error) {
					this.log(`Error closing changed server ${name}: ${getErrorMessage(error)}`);
				}
			}
			this.servers.delete(name);
			changed = true;
			if (!nextConfig.disabled) {
				starts.push(this.startServer(name, nextConfig));
			} else {
				this.log(`Server ${name} is now disabled, kept stopped`);
			}
		}

		await Promise.allSettled(starts);
		this.globalConfig = this.configSource.loadGlobal() ?? undefined;
		this.projectConfig = this.configSource.loadProject() ?? undefined;
		this.lastSignature = this.combinedSignature();
		this.log(`Reconcile done, ${this.servers.size} servers active`);
		return changed;
	}

	private log(message: string): void {
		this.onDiagnostic?.(message);
	}
}

function toView(server: ManagedMcpServer): McpServerView {
	return {
		name: server.name,
		config: server.config,
		status: server.status,
		serverInfo: server.serverInfo,
		tools: server.tools,
		resources: server.resources,
		error: server.error,
		pid: server.pid,
		startedAt: server.startedAt,
	};
}

function toBinding(server: ManagedMcpServer): McpServerBinding {
	return { view: toView(server), client: server.client };
}

function mapsEqualConfig(
	left: ReadonlyMap<string, McpServerConfig>,
	right: ReadonlyMap<string, McpServerConfig>,
): boolean {
	if (left.size !== right.size) return false;
	for (const [name, config] of left) {
		const other = right.get(name);
		if (!other || JSON.stringify(other) !== JSON.stringify(config)) return false;
	}
	return true;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
