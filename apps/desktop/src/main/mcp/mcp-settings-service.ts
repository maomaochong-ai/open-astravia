import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAstraviaHomePath } from "@astravia/action-rpc";
import { CONFIG_DIR_NAME } from "@astravia/coding-agent/config";
import { atomicWriteJSON } from "@astravia/toolkit/atomic-write";
import type { McpServerDetail, McpServerSummary, McpServerUpsertData } from "@astravia-org/capability-sdk";
import type { AppMonitorEvent, AppMonitorResourceSource } from "../../preload/api-types/app-monitor.js";
import type {
	McpConfigData,
	McpHttpServerConfigData,
	McpServerConfigData,
	McpSseServerConfigData,
	McpStdioServerConfigData,
} from "../../preload/api-types/mcp.js";
import { isRemoteMcpServer, isStdioMcpServer } from "../../shared/mcp-server-kind.js";
import { recordAbilityInstall, removeAbilityLedgerEntry } from "../abilities/ability-ledger.js";
import { stopOpenMarketplaceManagedMcpRuntime } from "../abilities/open-marketplace/open-marketplace-mcp-runtime-host.js";
import { recordAppMonitorEvent } from "../app-monitor/app-monitor-service.js";
import { validateMcpConfig } from "../mcp-config-validation.js";
import { type McpInstallScope, projectMcpConfigPath, resolveMcpInstallLocation } from "./mcp-install-location.js";
import { ensureMcpFileMigrations } from "./migrations/index.js";

/** 项目层配置：读不到就是空，坏文件按空处理（下次写入会覆盖成合法内容）。 */
async function readProjectMcpConfig(path: string): Promise<McpConfigData> {
	try {
		return validateMcpConfig(JSON.parse(await readFile(path, "utf8")));
	} catch {
		return { mcpServers: {} };
	}
}

export interface McpSettingsServiceOptions {
	readonly readConfig: () => Promise<McpConfigData>;
	readonly writeConfig: (config: McpConfigData) => Promise<void>;
	readonly recordEvent?: (event: Extract<AppMonitorEvent, { type: "resource.lifecycle" }>) => void;
}

const MCP_CONFIG_PATH = join(getAstraviaHomePath(), "agent", "mcp.json");
const DEFAULT_MCP_CONFIG: McpConfigData = { mcpServers: {} };

export async function readMcpConfig(): Promise<McpConfigData> {
	try {
		await ensureMcpFileMigrations();
	} catch {
		// Keep the existing tolerant read contract. A failed migration is retried on the next app launch.
	}
	try {
		const raw = await readFile(MCP_CONFIG_PATH, "utf8");
		return validateMcpConfig(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_MCP_CONFIG };
	}
}

export async function writeMcpConfig(config: McpConfigData): Promise<void> {
	const previous = await readMcpConfig();
	const next = validateMcpConfig(config);
	atomicWriteJSON(MCP_CONFIG_PATH, next);
	await stopUnusedManagedMcpRuntimes(previous, next, stopOpenMarketplaceManagedMcpRuntime);
}

export async function stopUnusedManagedMcpRuntimes(
	previous: McpConfigData,
	next: McpConfigData,
	stop: (runtimeId: string) => Promise<void>,
): Promise<void> {
	const activeIds = new Set(
		Object.values(next.mcpServers).flatMap((server) =>
			server.type === "http" && server.managedRuntimeId && !server.disabled ? [server.managedRuntimeId] : [],
		),
	);
	const previousIds = new Set(
		Object.values(previous.mcpServers).flatMap((server) =>
			server.type === "http" && server.managedRuntimeId ? [server.managedRuntimeId] : [],
		),
	);
	await Promise.all([...previousIds].filter((id) => !activeIds.has(id)).map(stop));
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

type RemoteUpsertData = Extract<McpServerUpsertData, { type: "http" | "sse" }>;

function isRemoteUpsertData(data: McpServerUpsertData): data is RemoteUpsertData {
	return data.type === "http" || data.type === "sse";
}

function buildHttpConfig(existing: McpServerConfigData | undefined, data: RemoteUpsertData): McpHttpServerConfigData {
	const previous = existing?.type === "http" ? existing : undefined;
	const url = data.url ?? previous?.url;
	if (!url) throw new Error("HTTP MCP server requires url.");
	return {
		...(previous ?? {}),
		...data,
		type: "http",
		url,
		...(data.headers === undefined ? {} : { headers: { ...data.headers } }),
		...(data.autoApprove === undefined ? {} : { autoApprove: [...data.autoApprove] }),
	};
}

/** 只在同为 sse 时沿用旧值；从 http 改成 sse 不能把受管 runtime 等 http 专属字段带过来。 */
function buildSseConfig(existing: McpServerConfigData | undefined, data: RemoteUpsertData): McpSseServerConfigData {
	const previous = existing?.type === "sse" ? existing : undefined;
	const url = data.url ?? previous?.url;
	if (!url) throw new Error("SSE MCP server requires url.");
	return {
		...(previous ?? {}),
		...data,
		type: "sse",
		url,
		...(data.headers === undefined ? {} : { headers: { ...data.headers } }),
		...(data.autoApprove === undefined ? {} : { autoApprove: [...data.autoApprove] }),
	};
}

function redactServer(name: string, server: McpServerConfigData): McpServerDetail {
	const common = {
		name,
		disabled: Boolean(server.disabled),
		...(server.autoApprove === undefined ? {} : { autoApprove: [...server.autoApprove] }),
		...(server.startupTimeout === undefined ? {} : { startupTimeout: server.startupTimeout }),
		...(server.debug === undefined ? {} : { debug: server.debug }),
	};
	if (isRemoteMcpServer(server)) {
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
			type: server.type,
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

	/**
	 * 解析这次写入落在哪个文件。
	 *
	 * 项目层文件由调用方给出 cwd 后解析；没有 cwd 又声明 project 直接报错，
	 * 绝不悄悄退回全局——那正是最难排查的一类问题（用户以为装在项目里）。
	 */
	private resolveTarget(options?: { scope?: McpInstallScope; cwd?: string }): {
		readonly scope: McpInstallScope;
		readonly read: () => Promise<McpConfigData>;
		readonly write: (config: McpConfigData) => Promise<void>;
	} {
		const location = resolveMcpInstallLocation({
			scope: options?.scope,
			cwd: options?.cwd,
			isRemoteProject: options?.cwd?.startsWith("ssh://") ?? false,
			configDirName: CONFIG_DIR_NAME,
		});
		if (!location.ok) throw new Error(location.error);
		if (location.scope === "global") {
			return { scope: "global", read: () => this.options.readConfig(), write: this.options.writeConfig };
		}
		const path = projectMcpConfigPath(location.projectDir ?? "", CONFIG_DIR_NAME);
		return {
			scope: "project",
			read: () => readProjectMcpConfig(path),
			write: async (config) => {
				await mkdir(dirname(path), { recursive: true });
				await atomicWriteJSON(path, config);
			},
		};
	}

	async list(): Promise<McpServerSummary[]> {
		const config = await this.getConfig();
		return Object.entries(config.mcpServers).map(([name, server]) => ({
			name,
			type: isRemoteMcpServer(server) ? server.type : "stdio",
			disabled: Boolean(server.disabled),
			...(isRemoteMcpServer(server) ? { url: server.url } : { command: server.command }),
		}));
	}

	async get(name: string): Promise<McpServerDetail> {
		const config = await this.getConfig();
		const server = config.mcpServers[name];
		if (!server) throw new Error(`MCP server not found: ${name}`);
		return redactServer(name, server);
	}

	/**
	 * @param options.abilityVersion 市场能力的版本号；给出时写入能力安装台账。
	 * 用户手工添加的 server 不是市场能力，不传则不进台账。
	 */
	async upsert(
		name: string,
		data: McpServerUpsertData,
		options?: { abilityVersion?: string; scope?: McpInstallScope; cwd?: string },
	): Promise<McpServerDetail> {
		const target = this.resolveTarget(options);
		return this.runMutation(async () => {
			const config = await target.read();
			const existing = config.mcpServers[name];
			let next: McpServerConfigData;
			if (isRemoteUpsertData(data)) {
				next = data.type === "sse" ? buildSseConfig(existing, data) : buildHttpConfig(existing, data);
			} else {
				const previous = existing && isStdioMcpServer(existing) ? existing : undefined;
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
			await target.write(
				validateMcpConfig({
					mcpServers: { ...config.mcpServers, [name]: next },
				}),
			);
			if (options?.abilityVersion) recordAbilityInstall("mcp", name, options.abilityVersion);
			if (target.scope === "global")
				this.recordLifecycle(
					name,
					existing ? "updated" : "installed",
					options?.abilityVersion ? "market" : existing ? undefined : "custom",
				);
			return redactServer(name, next);
		});
	}

	async setEnabled(
		name: string,
		enabled: boolean,
		options?: { scope?: McpInstallScope; cwd?: string },
	): Promise<void> {
		const target = this.resolveTarget(options);
		await this.runMutation(async () => {
			const config = await target.read();
			const existing = config.mcpServers[name];
			if (!existing) throw new Error(`MCP server not found: ${name}`);
			const wasEnabled = !existing.disabled;
			await target.write(
				validateMcpConfig({
					mcpServers: {
						...config.mcpServers,
						[name]: { ...existing, disabled: !enabled },
					},
				}),
			);
			if (wasEnabled !== enabled && target.scope === "global") {
				this.recordLifecycle(name, enabled ? "enabled" : "disabled");
			}
		});
	}

	async remove(name: string, options?: { scope?: McpInstallScope; cwd?: string }): Promise<void> {
		const target = this.resolveTarget(options);
		await this.runMutation(async () => {
			const config = await target.read();
			if (!config.mcpServers[name]) throw new Error(`MCP server not found: ${name}`);
			const mcpServers = { ...config.mcpServers };
			delete mcpServers[name];
			await target.write({ mcpServers });
			if (target.scope === "global") {
				removeAbilityLedgerEntry("mcp", name);
				this.recordLifecycle(name, "uninstalled");
			}
		});
	}

	private recordLifecycle(
		resourceId: string,
		operation: "installed" | "updated" | "uninstalled" | "enabled" | "disabled",
		source?: AppMonitorResourceSource,
	): void {
		try {
			this.options.recordEvent?.({
				type: "resource.lifecycle",
				resourceKind: "mcp",
				resourceId,
				operation,
				...(source ? { source } : {}),
			});
		} catch {
			// Monitoring and logging must not affect MCP configuration changes.
		}
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
		recordEvent: recordAppMonitorEvent,
	});
	return desktopMcpSettingsService;
}
