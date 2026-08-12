import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
	AgentPluginMcpServerConfig,
	AgentPluginRuntimeConfig,
	McpServerContribution,
	SystemPromptBlock,
	SystemPromptOperation,
} from "@vetta/runtime-core";
import { normalizePluginAgentModes, parsePluginMcpServerConfig } from "@vetta-org/plugin-sdk/manifest";
import type { InstalledPlugin, PluginMcpServerConfig, PluginPermission } from "../../preload/api-types/plugins.js";
import type { PluginAgentContributionRegistry } from "./plugin-agent-contribution-registry.js";

interface PluginRuntimeConfigLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	warn(message: string, error?: unknown): void;
}

export interface PluginRuntimeConfigDependencies {
	plugins: readonly InstalledPlugin[];
	isContributionModeActive(pluginId: string): boolean;
	contributions: PluginAgentContributionRegistry;
	resolveResource(plugin: InstalledPlugin, relativePath: string): string;
	resolveMcpRoot(plugin: InstalledPlugin): string;
	logger: PluginRuntimeConfigLogger;
}

export function summarizeAgentPluginRuntimeConfig(
	config: AgentPluginRuntimeConfig | undefined,
): Record<string, unknown> {
	return {
		systemPromptPlugins: config?.systemPromptContributions?.map((item) => item.pluginId) ?? [],
		skillPlugins: config?.skillPathContributions?.map((item) => item.pluginId) ?? [],
		toolPolicyPlugins: config?.toolPolicyContributions?.map((item) => item.pluginId) ?? [],
		toolContributions: config?.toolContributions?.map((tool) => `${tool.pluginId}:${tool.name}`) ?? [],
		continuationContributions:
			config?.continuationContributions?.map((provider) => `${provider.pluginId}:${provider.id}`) ?? [],
		systemPromptProviders:
			config?.systemPromptProviderContributions?.map((provider) => `${provider.pluginId}:${provider.id}`) ?? [],
		mcpServers: config?.mcpServerContributions?.map((item) => item.runtimeName) ?? [],
	};
}

export function buildPluginMcpRuntimeName(pluginId: string, localName: string): string {
	return `plugin-${normalizeMcpNameSegment(pluginId)}-${normalizeMcpNameSegment(localName)}`;
}

export function buildPluginRuntimeConfig(
	dependencies: PluginRuntimeConfigDependencies,
): AgentPluginRuntimeConfig | undefined {
	// 工作模式不再排除任何插件贡献（零硬闸决策）：manifest 的 agent_mode 只是偏好声明，
	// 由下游按模式做排序与详略处理，这里一律放行。
	const enabledPlugins = dependencies.plugins.filter(
		(plugin) => plugin.enabled && plugin.agent && dependencies.isContributionModeActive(plugin.id),
	);
	const enabledToolPlugins = dependencies.plugins.filter(
		(plugin) => plugin.enabled && dependencies.isContributionModeActive(plugin.id),
	);
	dependencies.logger.debug("build runtime config start", {
		agentPlugins: enabledPlugins.map((plugin) => plugin.id),
		enabledPlugins: enabledToolPlugins.map((plugin) => plugin.id),
		dynamicToolPlugins: dependencies.contributions.getToolSummary(),
	});

	const systemPromptContributions: NonNullable<AgentPluginRuntimeConfig["systemPromptContributions"]> = [];
	const skillPathContributions: NonNullable<AgentPluginRuntimeConfig["skillPathContributions"]> = [];
	const toolPolicyContributions: NonNullable<AgentPluginRuntimeConfig["toolPolicyContributions"]> = [];
	const toolContributions: NonNullable<AgentPluginRuntimeConfig["toolContributions"]> = [];
	const continuationContributions: NonNullable<AgentPluginRuntimeConfig["continuationContributions"]> = [];
	const systemPromptProviderContributions: NonNullable<AgentPluginRuntimeConfig["systemPromptProviderContributions"]> =
		[];
	const mcpServerContributions: McpServerContribution[] = [];

	for (const plugin of enabledPlugins) {
		try {
			const agent = plugin.agent;
			if (!agent) continue;
			if (
				agent.systemPrompt &&
				(hasGrantedPermission(plugin, "agent.systemPrompt.write") ||
					hasGrantedPermission(plugin, "agent.systemPrompt.fullControl"))
			) {
				const operations: SystemPromptOperation[] = (agent.systemPrompt.promptPaths ?? []).map((path, index) => ({
					type: "addBlock",
					block: readPromptBlock(dependencies, plugin, path, index),
				}));
				if (operations.length > 0) systemPromptContributions.push({ pluginId: plugin.id, operations });
			}
			if (agent.skillPaths && hasGrantedPermission(plugin, "agent.skills.control")) {
				skillPathContributions.push({
					pluginId: plugin.id,
					paths: agent.skillPaths.map((path) => dependencies.resolveResource(plugin, path)),
				});
			}
			if (agent.toolPolicy && hasGrantedPermission(plugin, "agent.tools.control")) {
				toolPolicyContributions.push({
					pluginId: plugin.id,
					allow: agent.toolPolicy.allow,
					deny: agent.toolPolicy.deny,
				});
			}
			if (agent.mcpServers) mcpServerContributions.push(...buildMcpContributions(dependencies, plugin));
		} catch (error) {
			dependencies.logger.warn(`Skipping agent contribution for ${plugin.id}:`, error);
		}
	}

	for (const plugin of enabledToolPlugins) {
		if (!hasGrantedPermission(plugin, "agent.tools.register")) {
			dependencies.logger.debug("skip tool contributions: missing register permission", { pluginId: plugin.id });
			continue;
		}
		if (!hasGrantedPermission(plugin, "agent.toolHandler.execute")) {
			dependencies.logger.debug("skip tool contributions: missing execute permission", { pluginId: plugin.id });
			continue;
		}
		const registeredTools = dependencies.contributions.getTools(plugin.id);
		if (registeredTools.length === 0) {
			dependencies.logger.debug("skip tool contributions: no dynamic tools registered", { pluginId: plugin.id });
			continue;
		}
		for (const tool of registeredTools) {
			toolContributions.push({ ...tool, pluginId: plugin.id });
		}
	}

	for (const plugin of enabledToolPlugins) {
		if (
			!hasGrantedPermission(plugin, "agent.systemPrompt.write") &&
			!hasGrantedPermission(plugin, "agent.systemPrompt.fullControl")
		) {
			continue;
		}
		for (const provider of dependencies.contributions.getSystemPrompts(plugin.id)) {
			systemPromptProviderContributions.push({ ...provider, pluginId: plugin.id });
		}
	}

	for (const plugin of enabledToolPlugins) {
		if (!hasGrantedPermission(plugin, "agent.continuation.register")) continue;
		for (const provider of dependencies.contributions.getContinuations(plugin.id)) {
			continuationContributions.push({ ...provider, pluginId: plugin.id });
		}
	}

	const config: AgentPluginRuntimeConfig = {};
	if (systemPromptContributions.length > 0) config.systemPromptContributions = systemPromptContributions;
	if (skillPathContributions.length > 0) config.skillPathContributions = skillPathContributions;
	if (toolPolicyContributions.length > 0) config.toolPolicyContributions = toolPolicyContributions;
	if (toolContributions.length > 0) config.toolContributions = toolContributions;
	if (continuationContributions.length > 0) config.continuationContributions = continuationContributions;
	if (systemPromptProviderContributions.length > 0) {
		config.systemPromptProviderContributions = systemPromptProviderContributions;
	}
	if (mcpServerContributions.length > 0) config.mcpServerContributions = mcpServerContributions;
	const result = Object.keys(config).length > 0 ? config : undefined;
	dependencies.logger.debug("build runtime config done", summarizeAgentPluginRuntimeConfig(result));
	return result;
}

function normalizeMcpNameSegment(raw: string): string {
	const normalized = raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (!normalized) throw new Error(`Invalid plugin MCP name segment: ${JSON.stringify(raw)}`);
	return normalized;
}

function buildMcpContributions(
	dependencies: PluginRuntimeConfigDependencies,
	plugin: InstalledPlugin,
): McpServerContribution[] {
	const declared = plugin.agent?.mcpServers;
	if (!declared) return [];
	if (!hasGrantedPermission(plugin, "agent.mcp.control")) {
		dependencies.logger.debug("skip mcp contributions: missing agent.mcp.control", { pluginId: plugin.id });
		return [];
	}

	let servers: Record<string, PluginMcpServerConfig>;
	try {
		if (typeof declared === "string") {
			const configPath = dependencies.resolveResource(plugin, declared);
			if (!existsSync(configPath)) {
				dependencies.logger.warn(`Plugin ${plugin.id}: MCP config missing at ${declared}`);
				return [];
			}
			const parsed: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
			if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
				dependencies.logger.warn(`Plugin ${plugin.id}: MCP config is not an object`);
				return [];
			}
			const map = (parsed as Record<string, unknown>).mcpServers;
			if (map == null || typeof map !== "object" || Array.isArray(map)) {
				dependencies.logger.warn(`Plugin ${plugin.id}: MCP config missing mcpServers object`);
				return [];
			}
			servers = {};
			for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
				servers[name] = parsePluginMcpServerConfig(name, value);
			}
		} else {
			servers = declared;
		}
	} catch (error) {
		dependencies.logger.warn(`Plugin ${plugin.id}: failed to load MCP servers:`, error);
		return [];
	}

	const contributions: McpServerContribution[] = [];
	for (const [localName, config] of Object.entries(servers)) {
		try {
			contributions.push({
				pluginId: plugin.id,
				localName,
				runtimeName: buildPluginMcpRuntimeName(plugin.id, localName),
				config: resolveMcpServerConfig(dependencies.resolveMcpRoot(plugin), config),
				agent_mode: normalizePluginAgentModes(config.agent_mode),
			});
		} catch (error) {
			dependencies.logger.warn(`Plugin ${plugin.id}: skip MCP server '${localName}':`, error);
		}
	}
	return contributions;
}

function resolveMcpServerConfig(pluginRoot: string, config: PluginMcpServerConfig): AgentPluginMcpServerConfig {
	if (config.type === "http") return { ...config };
	return {
		...config,
		type: config.type,
		command: resolvePathArgument(pluginRoot, config.command),
		args: config.args?.map((argument) => resolvePathArgument(pluginRoot, argument)),
		cwd: resolvePathArgument(pluginRoot, config.cwd === undefined ? "." : config.cwd),
	};
}

function resolvePathArgument(pluginRoot: string, value: string): string {
	if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) return value;
	if (
		value === "." ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.includes("/") ||
		value.includes("\\")
	) {
		return resolve(pluginRoot, value);
	}
	return value;
}

function readPromptBlock(
	dependencies: PluginRuntimeConfigDependencies,
	plugin: InstalledPlugin,
	relativePath: string,
	index: number,
	options?: { id?: string; priority?: number; enabled?: boolean },
): SystemPromptBlock {
	const content = readFileSync(dependencies.resolveResource(plugin, relativePath), "utf-8");
	return {
		id: options?.id ?? `plugin.${plugin.id}.systemPrompt.${index + 1}`,
		type: "plugin",
		source: { kind: "plugin", pluginId: plugin.id },
		content,
		priority: options?.priority ?? 850,
		enabled: options?.enabled ?? content.trim().length > 0,
	};
}

function hasGrantedPermission(plugin: InstalledPlugin, permission: PluginPermission): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}
