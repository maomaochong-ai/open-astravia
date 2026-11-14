import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { McpConfigSource } from "@astravia/runtime-mcp/config";
import type { McpConfig, McpServerConfig } from "../protocol/index.js";
import { isHttpServerConfig } from "../protocol/index.js";
import { parseMcpConfig } from "./schemas.js";

export interface FileMcpConfigSourceOptions {
	readonly globalConfigPath: string;
	readonly projectConfigPath: string;
	/**
	 * 其他 Agent 约定的项目级 `.mcp.json`（Claude Code 等）。只读，读取时并入项目层，
	 * 同名 server 以 `projectConfigPath` 为准；文件本身永不被改写。
	 */
	readonly compatProjectConfigPath?: string;
	readonly projectRoot: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly includeServer?: (input: {
		readonly origin: "global" | "project";
		readonly name: string;
		readonly config: McpServerConfig;
	}) => boolean;
	readonly onDiagnostic?: (message: string) => void;
}

/** File-backed MCP config adapter with no product-specific path resolution. */
export class FileMcpConfigSource implements McpConfigSource {
	private readonly environment: Readonly<Record<string, string | undefined>>;
	private readonly reportedDiagnostics = new Set<string>();

	constructor(private readonly options: FileMcpConfigSourceOptions) {
		this.environment = options.environment ?? process.env;
	}

	loadGlobal(): McpConfig | null {
		return this.filterConfig(this.loadConfigFromPath(this.options.globalConfigPath), "global");
	}

	loadProject(): McpConfig | null {
		const native = this.loadConfigFromPath(this.options.projectConfigPath);
		const compat = this.loadCompatProjectConfig();
		if (!compat) return this.filterConfig(native, "project");
		// 同名整体替换而不是字段合并：避免把两个文件里的 command 与 args 拼成谁都没写过的组合。
		return this.filterConfig({ mcpServers: { ...compat.mcpServers, ...(native?.mcpServers ?? {}) } }, "project");
	}

	loadMerged(): McpConfig {
		const globalConfig = this.loadGlobal();
		const projectConfig = this.loadProject();
		if (!globalConfig && !projectConfig) return { mcpServers: {} };
		if (!globalConfig && projectConfig) return this.processConfig(projectConfig);
		if (globalConfig && !projectConfig) return this.processConfig(globalConfig);
		if (globalConfig && projectConfig) {
			return this.processConfig(this.mergeConfigs(globalConfig, projectConfig));
		}
		return { mcpServers: {} };
	}

	getMergedSignature(): string {
		const parts: string[] = [];
		const paths = [this.options.globalConfigPath, this.options.projectConfigPath];
		if (this.options.compatProjectConfigPath) paths.push(this.options.compatProjectConfigPath);
		for (const path of paths) {
			if (!existsSync(path)) {
				parts.push(`${path}:missing`);
				continue;
			}
			try {
				const stat = statSync(path);
				const content = readFileSync(path, "utf8");
				const hash = createHash("sha1").update(content).digest("hex").slice(0, 16);
				parts.push(`${path}:${stat.mtimeMs}:${hash}`);
			} catch {
				parts.push(`${path}:err`);
			}
		}
		return parts.length === 0 ? "none" : parts.join("|");
	}

	getConfigPaths(): { readonly global: string; readonly project: string } {
		return { global: this.options.globalConfigPath, project: this.options.projectConfigPath };
	}

	private loadConfigFromPath(path: string): McpConfig | null {
		if (!existsSync(path)) return null;
		try {
			return parseMcpConfig(JSON.parse(readFileSync(path, "utf8")));
		} catch (error) {
			throw new Error(`Failed to load MCP config from ${path}: ${(error as Error).message}`);
		}
	}

	private filterConfig(config: McpConfig | null, origin: "global" | "project"): McpConfig | null {
		if (!config || !this.options.includeServer) return config;
		return {
			mcpServers: Object.fromEntries(
				Object.entries(config.mcpServers).filter(([name, serverConfig]) =>
					this.options.includeServer?.({ origin, name, config: serverConfig }),
				),
			),
		};
	}

	private mergeConfigs(globalConfig: McpConfig, projectConfig: McpConfig): McpConfig {
		const mcpServers: Record<string, McpServerConfig> = { ...globalConfig.mcpServers };
		for (const [name, config] of Object.entries(projectConfig.mcpServers)) {
			mcpServers[name] = mcpServers[name] ? { ...mcpServers[name], ...config } : config;
		}
		return { mcpServers };
	}

	private processConfig(config: McpConfig): McpConfig {
		const mcpServers: Record<string, McpServerConfig> = {};
		for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
			mcpServers[name] = this.processServerConfig(serverConfig);
		}
		return { mcpServers };
	}

	private processServerConfig(config: McpServerConfig): McpServerConfig {
		if (isHttpServerConfig(config)) {
			return {
				...config,
				url: this.replaceVariables(config.url),
				headers: config.headers
					? Object.fromEntries(
							Object.entries(config.headers).map(([key, value]) => [key, this.replaceVariables(value)]),
						)
					: undefined,
			};
		}
		return {
			...config,
			command: this.replaceVariables(config.command),
			args: config.args?.map((argument) => this.replaceVariables(argument)),
			cwd: config.cwd ? this.replaceVariables(config.cwd) : undefined,
			env: config.env
				? Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, this.replaceVariables(value)]))
				: undefined,
		};
	}

	/** 外部文件不受 Astravia 控制：整体或单个 server 无法识别时跳过并给出诊断，不能拖垮其余 MCP 配置。 */
	private loadCompatProjectConfig(): McpConfig | null {
		const path = this.options.compatProjectConfigPath;
		if (!path || !existsSync(path)) return null;
		let raw: unknown;
		try {
			raw = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			this.reportOnce(`Ignored ${path}: ${(error as Error).message}`);
			return null;
		}
		const entries = isRecord(raw) && isRecord(raw.mcpServers) ? Object.entries(raw.mcpServers) : undefined;
		if (!entries) {
			this.reportOnce(`Ignored ${path}: missing 'mcpServers' object`);
			return null;
		}
		const mcpServers: Record<string, McpServerConfig> = {};
		for (const [name, serverConfig] of entries) {
			try {
				Object.assign(mcpServers, parseMcpConfig({ mcpServers: { [name]: serverConfig } }).mcpServers);
			} catch (error) {
				this.reportOnce(`Skipped server '${name}' from ${path}: ${(error as Error).message}`);
			}
		}
		return Object.keys(mcpServers).length === 0 ? null : { mcpServers };
	}

	private reportOnce(message: string): void {
		if (this.reportedDiagnostics.has(message)) return;
		this.reportedDiagnostics.add(message);
		this.options.onDiagnostic?.(message);
	}

	private replaceVariables(value: string): string {
		return value.replace(/\$\{([^}]+)\}/g, (match, expression: string) => {
			// `${VAR:-default}` 是 `.mcp.json` 的通用写法：变量缺失或为空时取默认值。
			const separator = expression.indexOf(":-");
			const variableName = separator === -1 ? expression : expression.slice(0, separator);
			if (variableName === "PROJECT_ROOT") return this.options.projectRoot;
			const resolved = this.environment[variableName];
			if (separator === -1) return resolved ?? match;
			return resolved ? resolved : expression.slice(separator + 2);
		});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
