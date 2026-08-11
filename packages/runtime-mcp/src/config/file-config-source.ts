import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { McpConfig, McpServerConfig } from "../protocol/index.js";
import { isHttpServerConfig } from "../protocol/index.js";
import { parseMcpConfig } from "./schemas.js";

export interface McpConfigSource {
	loadGlobal(): McpConfig | null;
	loadProject(): McpConfig | null;
	loadMerged(): McpConfig;
	getMergedSignature(): string;
	getConfigPaths(): { readonly global: string; readonly project: string };
}

export interface FileMcpConfigSourceOptions {
	readonly globalConfigPath: string;
	readonly projectConfigPath: string;
	readonly projectRoot: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
}

/** File-backed MCP config adapter with no product-specific path resolution. */
export class FileMcpConfigSource implements McpConfigSource {
	private readonly environment: Readonly<Record<string, string | undefined>>;

	constructor(private readonly options: FileMcpConfigSourceOptions) {
		this.environment = options.environment ?? process.env;
	}

	loadGlobal(): McpConfig | null {
		return this.loadConfigFromPath(this.options.globalConfigPath);
	}

	loadProject(): McpConfig | null {
		return this.loadConfigFromPath(this.options.projectConfigPath);
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
		for (const path of [this.options.globalConfigPath, this.options.projectConfigPath]) {
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

	private replaceVariables(value: string): string {
		return value.replace(/\$\{([^}]+)\}/g, (match, variableName: string) => {
			if (variableName === "PROJECT_ROOT") return this.options.projectRoot;
			return this.environment[variableName] ?? match;
		});
	}
}
