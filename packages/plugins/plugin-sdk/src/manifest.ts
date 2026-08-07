import { type Static, type TSchema } from "@sinclair/typebox";
import type { ValueError } from "@sinclair/typebox/errors";
import { Value } from "@sinclair/typebox/value";
import {
	PluginCommandNameSchema,
	PluginCommandNamesSchema,
	PluginIdSchema,
	PluginManifestSchema,
	PluginMcpServerConfigSchema,
	PluginVersionSchema,
	type PluginAgentManifest,
	type PluginManifest,
	type PluginManifestInput,
	type PluginMcpServerConfig,
	type PluginNetworkManifest,
	type PluginSettingSchema,
} from "./manifest-schema.js";
import { PLUGIN_PERMISSIONS, type PluginPermission } from "./permissions.js";

export {
	PluginAgentManifestSchema,
	PluginCommandNameSchema,
	PluginCommandNamesSchema,
	PluginIdSchema,
	PluginManifestSchema,
	PluginMcpHttpServerConfigSchema,
	PluginMcpServerConfigSchema,
	PluginMcpStdioServerConfigSchema,
	PluginModuleFederationManifestSchema,
	PluginNetworkManifestSchema,
	PluginPermissionSchema,
	PluginSettingDefinitionSchema,
	PluginVersionSchema,
} from "./manifest-schema.js";
export type {
	PluginAgentManifest,
	PluginManifest,
	PluginManifestInput,
	PluginMcpServerConfig,
	PluginNetworkManifest,
	PluginSettingSchema,
} from "./manifest-schema.js";
export { PLUGIN_PERMISSIONS } from "./permissions.js";
export type { PluginPermission } from "./permissions.js";

export interface PluginManifestResourceReference {
	field: string;
	path: string;
	kind: "file" | "file-or-directory";
}

function schemaErrorPath(path: string): string {
	if (!path) return "";
	return path
		.split("/")
		.slice(1)
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
		.map((segment) => {
			if (segment === "") return '[""]';
			return /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`;
		})
		.join("");
}

function mostSpecificSchemaError(issue: ValueError): ValueError {
	const nested = issue.errors.flatMap((iterator) =>
		[...iterator].map((child) => mostSpecificSchemaError(child)),
	);
	const deeper = nested.filter((child) => child.path.length > issue.path.length);
	if (deeper.length === 0) return issue;
	return deeper.reduce((best, child) => (child.path.length > best.path.length ? child : best));
}

function assertSchema<Schema extends TSchema>(
	schema: Schema,
	value: unknown,
	fieldName: string,
): asserts value is Static<Schema> {
	if (Value.Check(schema, value)) return;
	const firstIssue = Value.Errors(schema, value).First();
	const issue = firstIssue ? mostSpecificSchemaError(firstIssue) : undefined;
	const location = `${fieldName}${schemaErrorPath(issue?.path ?? "")}`;
	throw new Error(`Invalid plugin ${location}: ${issue?.message ?? "schema validation failed"}`);
}

function trimString(value: string): string {
	return value.trim();
}

function normalizeStringArray(values: string[] | undefined): string[] {
	return (values ?? []).map(trimString);
}

function normalizeOptionalAgentModes(value: string | string[] | undefined): string | string[] | undefined {
	if (value === undefined) return undefined;
	return Array.isArray(value) ? normalizeStringArray(value) : trimString(value);
}

function normalizeSetting(setting: PluginSettingSchema): PluginSettingSchema {
	const common = {
		key: trimString(setting.key),
		description: setting.description,
		default: setting.default,
		enum: setting.enum?.map(trimString),
		visibleWhen: setting.visibleWhen
			? {
					key: trimString(setting.visibleWhen.key),
					in: setting.visibleWhen.in.map(trimString),
				}
			: undefined,
	};
	if (setting.type === "desc") {
		return {
			...common,
			type: "desc",
			title: setting.title === undefined ? undefined : trimString(setting.title),
		};
	}
	return {
		...common,
		type: setting.type,
		title: trimString(setting.title),
	};
}

function normalizeSettings(settings: PluginSettingSchema[] | undefined): PluginSettingSchema[] | undefined {
	if (!settings || settings.length === 0) return undefined;
	return settings.map(normalizeSetting);
}

function normalizePermissions(permissions: PluginPermission[] | undefined): PluginPermission[] {
	return Array.from(new Set(permissions ?? []));
}

function normalizeNetworkHost(value: string): string {
	const raw = trimString(value).toLowerCase();
	if (raw === "*") return raw;
	const wildcard = raw.startsWith("*.");
	const candidate = wildcard ? raw.slice(2) : raw;
	if (!candidate || candidate.includes("*") || /[\\/?#@]/.test(candidate)) {
		throw new Error(`Invalid plugin network.allowedHosts entry: ${value}`);
	}
	const unwrapped = candidate.startsWith("[") && candidate.endsWith("]") ? candidate.slice(1, -1) : candidate;
	if (wildcard && unwrapped.includes(":")) {
		throw new Error(`Invalid plugin network.allowedHosts entry: ${value}`);
	}
	try {
		const parsed = new URL(`http://${unwrapped.includes(":") ? `[${unwrapped}]` : unwrapped}`);
		const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
		if (!hostname || parsed.port || parsed.username || parsed.password) throw new Error("invalid host");
		return wildcard ? `*.${hostname}` : hostname;
	} catch {
		throw new Error(`Invalid plugin network.allowedHosts entry: ${value}`);
	}
}

function normalizeNetworkManifest(network: PluginNetworkManifest | undefined): PluginNetworkManifest | undefined {
	if (!network) return undefined;
	return { allowedHosts: Array.from(new Set(network.allowedHosts.map(normalizeNetworkHost))) };
}

function normalizeModuleFederation(
	moduleFederation: PluginManifestInput["moduleFederation"],
): PluginManifest["moduleFederation"] {
	if (!moduleFederation) throw new Error("Missing plugin moduleFederation");
	return {
		remoteName: trimString(moduleFederation.remoteName),
		expose: trimString(moduleFederation.expose),
	};
}

function normalizeToolPolicy(
	toolPolicy: PluginAgentManifest["toolPolicy"],
): PluginAgentManifest["toolPolicy"] {
	if (!toolPolicy) return undefined;
	return {
		allow: normalizeStringArray(toolPolicy.allow),
		deny: normalizeStringArray(toolPolicy.deny),
	};
}

function normalizeMcpServers(
	mcpServers: PluginAgentManifest["mcpServers"],
): PluginAgentManifest["mcpServers"] {
	if (mcpServers === undefined) return undefined;
	if (typeof mcpServers === "string") {
		return validatePluginRelativePath(trimString(mcpServers), "agent.mcpServers");
	}
	const result: Record<string, PluginMcpServerConfig> = {};
	for (const [name, config] of Object.entries(mcpServers)) {
		result[trimString(name)] = normalizePluginMcpServerConfig(config);
	}
	return result;
}

function normalizeAgentManifest(agent: PluginAgentManifest | undefined): PluginAgentManifest | undefined {
	if (!agent) return undefined;
	return {
		systemPrompt: agent.systemPrompt
			? {
					promptPaths: normalizeStringArray(agent.systemPrompt.promptPaths).map((path) =>
						validatePluginRelativePath(path, "agent.systemPrompt.promptPaths"),
					),
				}
			: undefined,
		skillPaths: normalizeStringArray(agent.skillPaths).map((path) =>
			validatePluginRelativePath(path, "agent.skillPaths"),
		),
		mcpServers: normalizeMcpServers(agent.mcpServers),
		toolPolicy: normalizeToolPolicy(agent.toolPolicy),
	};
}

function normalizePluginMcpServerConfig(config: PluginMcpServerConfig): PluginMcpServerConfig {
	const common = {
		disabled: config.disabled,
		autoApprove: config.autoApprove?.map(trimString),
		startupTimeout: config.startupTimeout,
		debug: config.debug,
		displayName: config.displayName,
		description: config.description,
		agent_mode: normalizeOptionalAgentModes(config.agent_mode),
	};
	if (config.type === "http") {
		return {
			type: "http",
			url: trimString(config.url),
			headers: config.headers ? { ...config.headers } : undefined,
			oauthClientId: config.oauthClientId,
			oauthDeviceFlow: config.oauthDeviceFlow,
			oauthScopes: config.oauthScopes,
			...common,
		};
	}
	return {
		type: config.type,
		command: trimString(config.command),
		args: config.args ? [...config.args] : undefined,
		env: config.env ? { ...config.env } : undefined,
		cwd: config.cwd,
		...common,
	};
}

export function validatePluginId(id: string): void {
	if (!Value.Check(PluginIdSchema, id)) {
		throw new Error("Plugin id must be 1-64 chars: lowercase letters, numbers, dot, underscore, or dash");
	}
}

export function validatePluginVersion(version: string): void {
	if (!Value.Check(PluginVersionSchema, version)) {
		throw new Error("Plugin version must be 1-64 chars and cannot contain path separators");
	}
}

export function validatePluginRelativePath(value: string, fieldName: string): string {
	if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) {
		throw new Error(`Invalid plugin ${fieldName}`);
	}
	const parts: string[] = [];
	for (const part of value.replace(/\\/g, "/").split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length === 0) throw new Error(`Invalid plugin ${fieldName}`);
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	const normalized = parts.join("/");
	if (!normalized) throw new Error(`Invalid plugin ${fieldName}`);
	return normalized;
}

export function parsePluginCommandNames(value: unknown): string[] {
	if (value === undefined) return [];
	assertSchema(PluginCommandNamesSchema, value, "commands");
	return Array.from(new Set(value));
}

export function normalizePluginAgentModes(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	const values = Array.isArray(value) ? value : [value];
	const modes = values.map((item) => String(item).trim()).filter(Boolean);
	return modes.length > 0 ? modes : undefined;
}

export function parsePluginMcpServerConfig(name: string, raw: unknown): PluginMcpServerConfig {
	assertSchema(PluginMcpServerConfigSchema, raw, `MCP server '${name}'`);
	return normalizePluginMcpServerConfig(raw);
}

export function isPluginPassthroughIconRef(icon: string): boolean {
	return (
		icon.startsWith("http://") ||
		icon.startsWith("https://") ||
		/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon)
	);
}

export function isPluginPackagedIconPath(icon: string): boolean {
	return !isPluginPassthroughIconRef(icon);
}

export function parsePluginManifest(raw: unknown): PluginManifest {
	assertSchema(PluginManifestSchema, raw, "manifest");
	const runtime = raw.runtime ?? "esm";
	const commands = parsePluginCommandNames(raw.commands);
	const icon = raw.icon === undefined ? undefined : trimString(raw.icon);
	const permissions = normalizePermissions(raw.permissions);
	const network = normalizeNetworkManifest(raw.network);
	if (permissions.includes("network.fetch") && !network) {
		throw new Error("Plugin network.allowedHosts is required with network.fetch");
	}
	return {
		id: raw.id,
		name: trimString(raw.name),
		version: raw.version,
		pluginApiVersion: trimString(raw.pluginApiVersion),
		entry: validatePluginRelativePath(trimString(raw.entry), "entry"),
		runtime,
		moduleFederation:
			runtime === "module-federation" ? normalizeModuleFederation(raw.moduleFederation) : undefined,
		agent: normalizeAgentManifest(raw.agent),
		styles: normalizeStringArray(raw.styles).map((style) => validatePluginRelativePath(style, "styles")),
		permissions,
		network,
		commands: commands.length > 0 ? commands : undefined,
		contributes: raw.contributes
			? (() => {
					const settings = normalizeSettings(raw.contributes.settings);
					return settings ? { settings } : undefined;
				})()
			: undefined,
		description: raw.description,
		author: raw.author,
		icon:
			icon === undefined || isPluginPassthroughIconRef(icon)
				? icon
				: validatePluginRelativePath(icon, "icon"),
		guidingWords: raw.guidingWords?.map(trimString),
		defaultLocale: raw.defaultLocale ?? "zh",
		contributionMode: raw.contributionMode
			? { hardIsolation: raw.contributionMode.hardIsolation === true }
			: undefined,
		agent_mode: normalizePluginAgentModes(raw.agent_mode),
	};
}

export function listPluginManifestResources(
	manifest: PluginManifest,
): PluginManifestResourceReference[] {
	const resources: PluginManifestResourceReference[] = [
		{ field: "entry", path: manifest.entry, kind: "file" },
	];
	for (const stylePath of manifest.styles ?? []) {
		resources.push({ field: "styles", path: stylePath, kind: "file" });
	}
	if (manifest.icon && isPluginPackagedIconPath(manifest.icon)) {
		resources.push({ field: "icon", path: manifest.icon, kind: "file" });
	}
	for (const promptPath of manifest.agent?.systemPrompt?.promptPaths ?? []) {
		resources.push({ field: "agent.systemPrompt.promptPaths", path: promptPath, kind: "file-or-directory" });
	}
	for (const skillPath of manifest.agent?.skillPaths ?? []) {
		resources.push({ field: "agent.skillPaths", path: skillPath, kind: "file-or-directory" });
	}
	if (typeof manifest.agent?.mcpServers === "string") {
		resources.push({ field: "agent.mcpServers", path: manifest.agent.mcpServers, kind: "file" });
	}
	return resources;
}

function parseApiVersion(value: string): readonly [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareApiVersions(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return left[index] - right[index];
	}
	return 0;
}

export function isPluginApiCompatible(hostVersion: string, range: string): boolean {
	const host = parseApiVersion(hostVersion);
	if (!host) return false;
	const normalized = range.trim();
	const exact = parseApiVersion(normalized);
	if (exact) return exact[0] === host[0] && compareApiVersions(host, exact) >= 0;
	const caret = normalized.startsWith("^") ? parseApiVersion(normalized.slice(1)) : undefined;
	if (caret) return caret[0] === host[0] && compareApiVersions(host, caret) >= 0;
	if (normalized === `^${host[0]}` || normalized === `${host[0]}.x`) return true;
	const minimum = normalized.startsWith(">=") ? parseApiVersion(normalized.slice(2)) : undefined;
	return minimum !== undefined && compareApiVersions(host, minimum) >= 0;
}
