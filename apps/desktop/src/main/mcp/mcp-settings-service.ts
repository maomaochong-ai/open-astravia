import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { McpServerDetail, McpServerSummary, McpServerUpsertData } from "@vetta/capability-sdk";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import type {
	McpConfigData,
	McpHttpServerConfigData,
	McpServerConfigData,
	McpStdioServerConfigData,
} from "../../preload/api-types/mcp.js";
import { recordAbilityInstall, removeAbilityLedgerEntry } from "../abilities/ability-ledger.js";
import { validateMcpConfig } from "../mcp-config-validation.js";

export interface McpSettingsServiceOptions {
	readonly readConfig: () => Promise<McpConfigData>;
	readonly writeConfig: (config: McpConfigData) => Promise<void>;
}

const MCP_CONFIG_PATH = join(getVettaHomePath(), "agent", "mcp.json");
const DEFAULT_MCP_CONFIG: McpConfigData = { mcpServers: {} };

export async function readMcpConfig(): Promise<McpConfigData> {
	try {
		const raw = await readFile(MCP_CONFIG_PATH, "utf8");
		return validateMcpConfig(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_MCP_CONFIG };
	}
}

export async function writeMcpConfig(config: McpConfigData): Promise<void> {
	atomicWriteJSON(MCP_CONFIG_PATH, validateMcpConfig(config));
}

function redactRecordSecrets(
	record: Record<string, string> | undefined,
	secretKeys: readonly string[],
): Record<string, string> | undefined {
	if (!record) return undefined;
	const next: Record<string, string> = {};
	for (const [key, value] of Object.entries(record)) {
		const lower = key.toLowerCase();
		next[key] = secretKeys.some((secretKey) => lower.includes(secretKey)) ? "***" : value;
	}
	return next;
}

function redactServer(name: string, server: McpServerConfigData): McpServerDetail {
	const common = {
		name,
		disabled: Boolean(server.disabled),
		...(server.autoApprove === undefined ? {} : { autoApprove: [...server.autoApprove] }),
		...(server.startupTimeout === undefined ? {} : { startupTimeout: server.startupTimeout }),
		...(server.debug === undefined ? {} : { debug: server.debug }),
	};
	if (server.type === "http") {
		const headers = redactRecordSecrets(server.headers, [
			"authorization",
			"api-key",
			"apikey",
			"x-api-key",
			"token",
			"secret",
			"password",
		]);
		return {
			...common,
			type: "http",
			url: server.url,
			...(headers === undefined ? {} : { headers }),
		};
	}
	const env = redactRecordSecrets(server.env, ["token", "key", "secret", "password", "authorization"]);
	return {
		...common,
		type: "stdio",
		command: server.command,
		...(server.args === undefined ? {} : { args: [...server.args] }),
		...(env === undefined ? {} : { env }),
		...(server.cwd === undefined ? {} : { cwd: server.cwd }),
	};
}

export class McpSettingsService {
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(private readonly options: McpSettingsServiceOptions) {}

	async getConfig(): Promise<McpConfigData> {
		await this.mutationQueue;
		return this.options.readConfig();
	}

	async replaceConfig(config: unknown): Promise<void> {
		await this.runMutation(async () => {
			await this.options.writeConfig(validateMcpConfig(config));
		});
	}

	async list(): Promise<McpServerSummary[]> {
		const config = await this.getConfig();
		return Object.entries(config.mcpServers).map(([name, server]) => ({
			name,
			type: server.type === "http" ? "http" : "stdio",
			disabled: Boolean(server.disabled),
			...(server.type === "http" ? { url: server.url } : { command: server.command }),
		}));
	}

	async get(name: string): Promise<McpServerDetail> {
		const config = await this.getConfig();
		const server = config.mcpServers[name];
		if (!server) throw new Error(`MCP server not found: ${name}`);
		return redactServer(name, server);
	}

	/**
	 * @param options.abilityVersion 市场能力的版本号；给出时写入能力安装台账（ADR-0049）。
	 * 用户手工添加的 server 不是市场能力，不传则不进台账。
	 */
	async upsert(
		name: string,
		data: McpServerUpsertData,
		options?: { abilityVersion?: string },
	): Promise<McpServerDetail> {
		return this.runMutation(async () => {
			const config = await this.options.readConfig();
			const existing = config.mcpServers[name];
			let next: McpServerConfigData;
			if (data.type === "http") {
				const previous = existing?.type === "http" ? existing : undefined;
				const url = data.url ?? previous?.url;
				if (!url) throw new Error("HTTP MCP server requires url.");
				next = {
					...(previous ?? {}),
					...data,
					type: "http",
					url,
					...(data.headers === undefined ? {} : { headers: { ...data.headers } }),
					...(data.autoApprove === undefined ? {} : { autoApprove: [...data.autoApprove] }),
				} satisfies McpHttpServerConfigData;
			} else {
				const previous = existing && existing.type !== "http" ? existing : undefined;
				const command = data.command ?? previous?.command;
				if (!command) throw new Error("stdio MCP server requires command.");
				next = {
					...(previous ?? {}),
					...data,
					type: data.type,
					command,
					...(data.args === undefined ? {} : { args: [...data.args] }),
					...(data.env === undefined ? {} : { env: { ...data.env } }),
					...(data.autoApprove === undefined ? {} : { autoApprove: [...data.autoApprove] }),
				} satisfies McpStdioServerConfigData;
			}
			await this.options.writeConfig(
				validateMcpConfig({
					mcpServers: { ...config.mcpServers, [name]: next },
				}),
			);
			if (options?.abilityVersion) recordAbilityInstall("mcp", name, options.abilityVersion);
			return redactServer(name, next);
		});
	}

	async setEnabled(name: string, enabled: boolean): Promise<void> {
		await this.runMutation(async () => {
			const config = await this.options.readConfig();
			const existing = config.mcpServers[name];
			if (!existing) throw new Error(`MCP server not found: ${name}`);
			await this.options.writeConfig(
				validateMcpConfig({
					mcpServers: {
						...config.mcpServers,
						[name]: { ...existing, disabled: !enabled },
					},
				}),
			);
		});
	}

	async remove(name: string): Promise<void> {
		await this.runMutation(async () => {
			const config = await this.options.readConfig();
			if (!config.mcpServers[name]) throw new Error(`MCP server not found: ${name}`);
			const mcpServers = { ...config.mcpServers };
			delete mcpServers[name];
			await this.options.writeConfig({ mcpServers });
			removeAbilityLedgerEntry("mcp", name);
		});
	}

	private runMutation<Result>(mutation: () => Promise<Result>): Promise<Result> {
		const result = this.mutationQueue.then(mutation, mutation);
		this.mutationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

let desktopMcpSettingsService: McpSettingsService | undefined;

export function getDesktopMcpSettingsService(): McpSettingsService {
	desktopMcpSettingsService ??= new McpSettingsService({
		readConfig: readMcpConfig,
		writeConfig: writeMcpConfig,
	});
	return desktopMcpSettingsService;
}
