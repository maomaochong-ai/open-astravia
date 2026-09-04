import { createHash } from "node:crypto";
import {
	projectRuntimeConfigurationCatalog,
	RuntimeConfigurationCenter,
	type RuntimeConfigurationDefinition,
	type RuntimeConfigurationJsonObject,
	type RuntimeConfigurationJsonValue,
} from "@vetta/runtime-core/configuration";
import { CODING_IMAGE_CONFIGURATION } from "@vetta/runtime-tools";
import type {
	DesktopRuntimeConfigurationCatalog,
	DesktopRuntimeConfigurationConsumer,
	DesktopRuntimeConfigurationEntry,
	InstalledPlugin,
	PluginSettingSchema,
} from "../../preload/api.js";

const BUILTIN_DEFINITION_SOURCE = { id: "runtime-tools", revision: "coding-images-v1" } as const;
const DESKTOP_LAYER_SOURCE_ID = "desktop.runtime-configuration";
const DESKTOP_LAYER_ID = "desktop.persisted-settings";
const PLUGIN_CONFIGURATION_PREFIX = "plugin.";
const PLUGIN_CONFIGURATION_SUFFIX = ".settings";

interface RuntimeConfigurationServiceLogger {
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, error?: unknown): void;
}

interface ConfiguredToolSummary {
	readonly pluginId: string;
	readonly tools: readonly {
		readonly name: string;
		readonly settingKeys?: readonly string[];
		readonly support: "adapter";
	}[];
}

export interface DesktopRuntimeConfigurationServiceDependencies {
	readonly readAgentSettings: () => Record<string, unknown>;
	readonly updateAgentSettings: (mutate: (settings: Record<string, unknown>) => void) => void;
	readonly listPlugins: () => InstalledPlugin[];
	readonly getPluginSettings: (pluginId: string) => Record<string, unknown>;
	readonly setPluginSettings: (pluginId: string, values: Record<string, unknown>) => Record<string, unknown>;
	readonly publishPluginSettingsChanged: (pluginId: string, values: Record<string, unknown>) => void;
	readonly readConfiguredTools: () => readonly ConfiguredToolSummary[];
	readonly logger: RuntimeConfigurationServiceLogger;
}

/** Desktop Host 的配置控制面：汇总 Definition/Layer，持久化仍由各领域 Adapter 拥有。 */
export class DesktopRuntimeConfigurationService {
	private readonly center = new RuntimeConfigurationCenter();
	private readonly publishedPluginSources = new Map<string, string>();
	private builtinPublished = false;

	constructor(private readonly dependencies: DesktopRuntimeConfigurationServiceDependencies) {}

	async list(): Promise<DesktopRuntimeConfigurationCatalog> {
		this.synchronize();
		const lease = this.center.acquire();
		try {
			const catalog = projectRuntimeConfigurationCatalog(lease.snapshot);
			const plugins = this.dependencies.listPlugins();
			const configuredTools = this.dependencies.readConfiguredTools();
			return Object.freeze({
				...catalog,
				entries: Object.freeze(
					catalog.entries.map((entry): DesktopRuntimeConfigurationEntry => {
						const plugin = pluginForConfiguration(entry.configurationId, plugins);
						const pluginSettings = plugin ? this.dependencies.getPluginSettings(plugin.id) : undefined;
						return Object.freeze({
							...entry,
							owner: plugin
								? Object.freeze({ kind: "plugin" as const, pluginId: plugin.id })
								: Object.freeze({ kind: "builtin" as const }),
							consumers: Object.freeze(resolveConsumers(entry.configurationId, plugin, configuredTools)),
							configuredSensitivePaths: Object.freeze(
								plugin && pluginSettings
									? configuredPluginSensitivePaths(pluginSettings, plugin.settingsSchema ?? [])
									: [],
							),
						});
					}),
				),
			});
		} finally {
			await lease.release();
		}
	}

	async set(
		configurationId: string,
		patch: RuntimeConfigurationJsonObject,
	): Promise<DesktopRuntimeConfigurationCatalog> {
		this.synchronize();
		const definitionLease = this.center.definitions.acquire(configurationId);
		let decoded: RuntimeConfigurationJsonObject;
		try {
			const definition = definitionLease.revision.definition;
			const current = this.readPersistedValue(configurationId);
			decoded = definition.codec.decode(mergeObjects(mergeObjects(definition.defaultValue, current), patch));
		} finally {
			await definitionLease.release();
		}

		if (configurationId === CODING_IMAGE_CONFIGURATION.id) {
			this.dependencies.updateAgentSettings((settings) => {
				settings.images = decoded;
			});
		} else {
			const pluginId = parsePluginConfigurationId(configurationId);
			if (!pluginId) throw new Error(`Runtime Configuration is not editable: ${configurationId}`);
			const effective = this.dependencies.setPluginSettings(pluginId, decoded);
			this.dependencies.publishPluginSettingsChanged(pluginId, effective);
		}
		this.dependencies.logger.info("runtime configuration updated", { configurationId });
		return this.list();
	}

	async close(): Promise<void> {
		await this.center.close();
	}

	private synchronize(): void {
		if (!this.builtinPublished) {
			this.center.definitions.upsert({
				source: BUILTIN_DEFINITION_SOURCE,
				definition: CODING_IMAGE_CONFIGURATION,
			});
			this.builtinPublished = true;
		}
		const plugins = this.dependencies
			.listPlugins()
			.filter((plugin) => (plugin.settingsSchema?.length ?? 0) > 0)
			.sort((left, right) => left.id.localeCompare(right.id));
		const activeSources = new Set<string>();
		for (const plugin of plugins) {
			const sourceId = pluginDefinitionSourceId(plugin.id);
			activeSources.add(sourceId);
			const revision = pluginDefinitionRevision(plugin);
			if (this.publishedPluginSources.get(sourceId) === revision) continue;
			this.center.definitions.replaceSource({ id: sourceId, revision }, [createPluginSettingsDefinition(plugin)]);
			this.publishedPluginSources.set(sourceId, revision);
		}
		for (const [sourceId, revision] of [...this.publishedPluginSources]) {
			if (activeSources.has(sourceId)) continue;
			this.center.definitions.replaceSource({ id: sourceId, revision: `${revision}:removed` }, []);
			this.publishedPluginSources.delete(sourceId);
		}

		const values: Record<string, RuntimeConfigurationJsonObject> = {};
		const images = this.dependencies.readAgentSettings().images;
		if (isRecord(images)) values[CODING_IMAGE_CONFIGURATION.id] = toJsonObject(images);
		for (const plugin of plugins) {
			values[pluginConfigurationId(plugin.id)] = readPluginLayerValue(
				this.dependencies.getPluginSettings(plugin.id),
				plugin.settingsSchema ?? [],
			);
		}
		const revision = hashJson(values);
		this.center.layers.replaceSource({ id: DESKTOP_LAYER_SOURCE_ID, revision }, [
			{
				id: DESKTOP_LAYER_ID,
				revision,
				precedence: 100,
				values,
			},
		]);
	}

	private readPersistedValue(configurationId: string): RuntimeConfigurationJsonObject {
		if (configurationId === CODING_IMAGE_CONFIGURATION.id) {
			const images = this.dependencies.readAgentSettings().images;
			return isRecord(images) ? toJsonObject(images) : {};
		}
		const pluginId = parsePluginConfigurationId(configurationId);
		if (!pluginId) throw new Error(`Unknown Runtime Configuration: ${configurationId}`);
		return toJsonObject(this.dependencies.getPluginSettings(pluginId));
	}
}

function createPluginSettingsDefinition(plugin: InstalledPlugin): RuntimeConfigurationDefinition {
	const settings = plugin.settingsSchema ?? [];
	const properties: Record<string, RuntimeConfigurationJsonObject> = {};
	const defaultValue: Record<string, RuntimeConfigurationJsonValue> = {};
	const sensitivePaths: string[] = [];
	for (const setting of settings) {
		if (setting.type === "desc") continue;
		properties[setting.key] = pluginSettingJsonSchema(setting);
		if (setting.default !== undefined && setting.type !== "secret") defaultValue[setting.key] = setting.default;
		if (setting.type === "secret") sensitivePaths.push(`/${escapeJsonPointer(setting.key)}`);
	}
	return {
		id: pluginConfigurationId(plugin.id),
		schemaVersion: 1,
		descriptor: {
			title: plugin.name,
			...(plugin.description === undefined ? {} : { description: plugin.description }),
			schema: { type: "object", additionalProperties: false, properties },
			presentation: {
				kind: "plugin-settings",
				pluginId: plugin.id,
				fields: settings.map(pluginSettingPresentation),
			},
			sensitivePaths,
		},
		codec: { decode: (value) => decodePluginSettings(value, settings) },
		defaultValue,
		apply: "next-turn",
	};
}

function decodePluginSettings(
	value: unknown,
	settings: readonly PluginSettingSchema[],
): RuntimeConfigurationJsonObject {
	if (!isRecord(value)) throw new TypeError("Plugin Runtime Configuration must be an object");
	const decoded: Record<string, RuntimeConfigurationJsonValue> = {};
	for (const setting of settings) {
		if (setting.type === "desc") continue;
		const field = value[setting.key];
		if (field === undefined) continue;
		if (setting.type === "boolean" && typeof field !== "boolean") throw invalidPluginSetting(setting.key);
		if (setting.type === "number" && (typeof field !== "number" || !Number.isFinite(field))) {
			throw invalidPluginSetting(setting.key);
		}
		if (
			(setting.type === "string" || setting.type === "secret" || setting.type === "enum") &&
			typeof field !== "string"
		) {
			throw invalidPluginSetting(setting.key);
		}
		if (setting.type === "enum" && !(setting.enum ?? []).includes(field as string)) {
			throw invalidPluginSetting(setting.key);
		}
		decoded[setting.key] = field as RuntimeConfigurationJsonValue;
	}
	return decoded;
}

function pluginSettingJsonSchema(
	setting: Exclude<PluginSettingSchema, { type: "desc" }>,
): RuntimeConfigurationJsonObject {
	if (setting.type === "boolean") return { type: "boolean" };
	if (setting.type === "number") return { type: "number" };
	if (setting.type === "enum") return { type: "string", enum: setting.enum ?? [] };
	return { type: "string", ...(setting.type === "secret" ? { writeOnly: true } : {}) };
}

function pluginSettingPresentation(setting: PluginSettingSchema): RuntimeConfigurationJsonObject {
	return {
		key: setting.key,
		type: setting.type,
		...(setting.title === undefined ? {} : { title: setting.title }),
		...(setting.description === undefined ? {} : { description: setting.description }),
		...(setting.enum === undefined ? {} : { enum: setting.enum }),
		...(setting.visibleWhen === undefined
			? {}
			: { visibleWhen: { key: setting.visibleWhen.key, in: setting.visibleWhen.in } }),
	};
}

function readPluginLayerValue(
	value: Record<string, unknown>,
	settings: readonly PluginSettingSchema[],
): RuntimeConfigurationJsonObject {
	const result: Record<string, RuntimeConfigurationJsonValue> = {};
	for (const setting of settings) {
		if (setting.type === "desc" || setting.type === "secret") continue;
		const field = value[setting.key];
		if (isJsonValue(field)) result[setting.key] = field;
	}
	return result;
}

function configuredPluginSensitivePaths(
	value: Record<string, unknown>,
	settings: readonly PluginSettingSchema[],
): string[] {
	return settings.flatMap((setting) => {
		if (setting.type !== "secret") return [];
		const field = value[setting.key];
		return typeof field === "string" && field.length > 0 ? [`/${escapeJsonPointer(setting.key)}`] : [];
	});
}

function resolveConsumers(
	configurationId: string,
	plugin: InstalledPlugin | undefined,
	configuredTools: readonly ConfiguredToolSummary[],
): DesktopRuntimeConfigurationConsumer[] {
	if (configurationId === CODING_IMAGE_CONFIGURATION.id) {
		return [
			{ kind: "tool", id: "read", support: "native" },
			{ kind: "runtime", id: "model-input-images", support: "native" },
		];
	}
	if (!plugin) return [];
	const tools = configuredTools.find(({ pluginId }) => pluginId === plugin.id)?.tools ?? [];
	return [
		{ kind: "plugin", id: plugin.id, support: "adapter" },
		...tools.map((tool) => ({
			kind: "tool" as const,
			id: tool.name,
			support: tool.support,
			settingKeys: tool.settingKeys,
		})),
	];
}

function pluginForConfiguration(
	configurationId: string,
	plugins: readonly InstalledPlugin[],
): InstalledPlugin | undefined {
	const pluginId = parsePluginConfigurationId(configurationId);
	return pluginId ? plugins.find((plugin) => plugin.id === pluginId) : undefined;
}

function pluginConfigurationId(pluginId: string): string {
	return `${PLUGIN_CONFIGURATION_PREFIX}${pluginId}${PLUGIN_CONFIGURATION_SUFFIX}`;
}

function parsePluginConfigurationId(configurationId: string): string | undefined {
	if (
		!configurationId.startsWith(PLUGIN_CONFIGURATION_PREFIX) ||
		!configurationId.endsWith(PLUGIN_CONFIGURATION_SUFFIX)
	) {
		return undefined;
	}
	return configurationId.slice(PLUGIN_CONFIGURATION_PREFIX.length, -PLUGIN_CONFIGURATION_SUFFIX.length) || undefined;
}

function pluginDefinitionSourceId(pluginId: string): string {
	return `desktop.plugin.${pluginId}`;
}

function pluginDefinitionRevision(plugin: InstalledPlugin): string {
	return `${plugin.activeVersion}:${hashJson(plugin.settingsSchema ?? [])}`;
}

function hashJson(value: unknown): string {
	return createHash("sha256")
		.update(JSON.stringify(value) ?? "undefined")
		.digest("hex")
		.slice(0, 24);
}

function mergeObjects(
	base: RuntimeConfigurationJsonObject,
	patch: RuntimeConfigurationJsonObject,
): RuntimeConfigurationJsonObject {
	const result: Record<string, RuntimeConfigurationJsonValue> = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		const current = result[key];
		result[key] = isRecord(current) && isRecord(value) ? mergeObjects(current, value) : value;
	}
	return result;
}

function toJsonObject(value: Record<string, unknown>): RuntimeConfigurationJsonObject {
	const result: Record<string, RuntimeConfigurationJsonValue> = {};
	for (const [key, field] of Object.entries(value)) {
		if (isJsonValue(field)) result[key] = field;
	}
	return result;
}

function isJsonValue(value: unknown): value is RuntimeConfigurationJsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPluginSetting(key: string): TypeError {
	return new TypeError(`Invalid plugin Runtime Configuration setting: ${key}`);
}

function escapeJsonPointer(value: string): string {
	return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
