import { createHash } from "node:crypto";
import {
	CODING_AGENT_COMPACTION_CONFIGURATION,
	CODING_AGENT_COMPACTION_CONFIGURATION_ID,
	type CodingAgentCompactionConfiguration,
	type ResolvedCompactionSettings,
} from "@vetta/coding-agent/settings";
import {
	projectRuntimeConfigurationCatalog,
	RuntimeConfigurationCenter,
	type RuntimeConfigurationJsonObject,
	type RuntimeConfigurationJsonValue,
} from "@vetta/runtime-core/configuration";
import { CODING_IMAGE_CONFIGURATION, VETTA_OCR_CONFIGURATION } from "@vetta/runtime-tools";
import type { OcrProviderDescriptor } from "@vetta-org/capability-sdk";
import type {
	DesktopRuntimeConfigurationCatalog,
	DesktopRuntimeConfigurationConsumer,
	DesktopRuntimeConfigurationEntry,
} from "../../preload/api.js";

const BUILTIN_DEFINITION_SOURCE = { id: "desktop-builtins", revision: "coding-context-images-and-ocr-v2" } as const;
const DESKTOP_LAYER_SOURCE_ID = "desktop.runtime-configuration";
const DESKTOP_LAYER_ID = "desktop.persisted-settings";

interface RuntimeConfigurationServiceLogger {
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, error?: unknown): void;
}

export interface DesktopRuntimeConfigurationServiceDependencies {
	readonly readAgentSettings: () => Record<string, unknown>;
	readonly updateAgentSettings: (mutate: (settings: Record<string, unknown>) => void) => void;
	readonly logger: RuntimeConfigurationServiceLogger;
	readonly listOcrProviders?: () => readonly OcrProviderDescriptor[];
}

/**
 * Desktop Host 的配置控制面：汇总内置 Definition 与持久化 Layer，值仍由各领域 Adapter 拥有。
 *
 * 插件配置不在此列——插件自己渲染配置界面并使用 `ctx.storage` / `ctx.secrets` 持久化（ADR-0105）。
 */
export class DesktopRuntimeConfigurationService {
	private readonly center = new RuntimeConfigurationCenter();
	private builtinPublished = false;

	constructor(private readonly dependencies: DesktopRuntimeConfigurationServiceDependencies) {}

	async list(): Promise<DesktopRuntimeConfigurationCatalog> {
		this.synchronize();
		const lease = this.center.acquire();
		try {
			const catalog = projectRuntimeConfigurationCatalog(lease.snapshot);
			return Object.freeze({
				...catalog,
				entries: Object.freeze(
					catalog.entries.map(
						(entry): DesktopRuntimeConfigurationEntry =>
							Object.freeze({
								...entry,
								descriptor:
									entry.configurationId === VETTA_OCR_CONFIGURATION.id
										? enrichOcrDescriptor(entry.descriptor, this.dependencies.listOcrProviders?.() ?? [])
										: entry.descriptor,
								consumers: Object.freeze(resolveConsumers(entry.configurationId)),
							}),
					),
				),
			});
		} finally {
			await lease.release();
		}
	}

	/** Turn admission 同步读取同一配置快照；无效的磁盘层由 Resolver 回退到产品默认值。 */
	readCompactionSettings(): ResolvedCompactionSettings {
		this.synchronize();
		const lease = this.center.acquire();
		try {
			const configuration =
				lease.snapshot.read(CODING_AGENT_COMPACTION_CONFIGURATION) ??
				CODING_AGENT_COMPACTION_CONFIGURATION.defaultValue;
			return toResolvedCompactionSettings(configuration);
		} finally {
			void lease
				.release()
				.catch((error) =>
					this.dependencies.logger.warn("failed to release context compaction configuration snapshot", error),
				);
		}
	}

	async set(
		configurationId: string,
		patch: RuntimeConfigurationJsonObject,
	): Promise<DesktopRuntimeConfigurationCatalog> {
		this.synchronize();
		if (
			configurationId !== CODING_AGENT_COMPACTION_CONFIGURATION.id &&
			configurationId !== CODING_IMAGE_CONFIGURATION.id &&
			configurationId !== VETTA_OCR_CONFIGURATION.id
		) {
			throw new Error(`Runtime Configuration is not editable: ${configurationId}`);
		}
		const definitionLease = this.center.definitions.acquire(configurationId);
		let decoded: RuntimeConfigurationJsonObject;
		try {
			const definition = definitionLease.revision.definition;
			const current = this.readPersistedValue(configurationId);
			decoded = definition.codec.decode(mergeObjects(mergeObjects(definition.defaultValue, current), patch));
		} finally {
			await definitionLease.release();
		}

		this.dependencies.updateAgentSettings((settings) => {
			if (configurationId === CODING_AGENT_COMPACTION_CONFIGURATION.id) {
				settings.compaction = toPersistedCompactionSettings(
					CODING_AGENT_COMPACTION_CONFIGURATION.codec.decode(decoded),
				);
			} else if (configurationId === CODING_IMAGE_CONFIGURATION.id) settings.images = decoded;
			else settings.ocr = decoded;
		});
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
				definition: CODING_AGENT_COMPACTION_CONFIGURATION,
			});
			this.center.definitions.upsert({
				source: BUILTIN_DEFINITION_SOURCE,
				definition: CODING_IMAGE_CONFIGURATION,
			});
			this.center.definitions.upsert({
				source: BUILTIN_DEFINITION_SOURCE,
				definition: VETTA_OCR_CONFIGURATION,
			});
			this.builtinPublished = true;
		}

		const values: Record<string, RuntimeConfigurationJsonObject> = {};
		const settings = this.dependencies.readAgentSettings();
		const compaction = settings.compaction;
		if (isRecord(compaction)) {
			values[CODING_AGENT_COMPACTION_CONFIGURATION.id] = projectPersistedCompactionSettings(compaction);
		}
		const images = settings.images;
		if (isRecord(images)) values[CODING_IMAGE_CONFIGURATION.id] = toJsonObject(images);
		const ocr = settings.ocr;
		if (isRecord(ocr)) values[VETTA_OCR_CONFIGURATION.id] = toJsonObject(ocr);
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
		const field = configurationId === CODING_IMAGE_CONFIGURATION.id ? "images" : "ocr";
		if (configurationId === CODING_AGENT_COMPACTION_CONFIGURATION.id) {
			const compaction = this.dependencies.readAgentSettings().compaction;
			return isRecord(compaction) ? projectPersistedCompactionSettings(compaction) : {};
		}
		const value = this.dependencies.readAgentSettings()[field];
		return isRecord(value) ? toJsonObject(value) : {};
	}
}

function projectPersistedCompactionSettings(value: Record<string, unknown>): RuntimeConfigurationJsonObject {
	const result: Record<string, RuntimeConfigurationJsonValue> = {};
	copyJsonField(value, result, "enabled");
	copyJsonField(value, result, "reserveTokens");
	copyJsonField(value, result, "keepRecentTokens");
	if (typeof value.minFreePercent === "number") {
		result.contextThresholdPercent = 100 - value.minFreePercent;
	} else if (isJsonValue(value.minFreePercent)) {
		result.contextThresholdPercent = value.minFreePercent;
	}
	return result;
}

function toPersistedCompactionSettings(
	configuration: CodingAgentCompactionConfiguration,
): RuntimeConfigurationJsonObject {
	return {
		enabled: configuration.enabled,
		reserveTokens: configuration.reserveTokens,
		minFreePercent: 100 - configuration.contextThresholdPercent,
		keepRecentTokens: configuration.keepRecentTokens,
	};
}

function toResolvedCompactionSettings(configuration: CodingAgentCompactionConfiguration): ResolvedCompactionSettings {
	return {
		enabled: configuration.enabled,
		reserveTokens: configuration.reserveTokens,
		minFreePercent: 100 - configuration.contextThresholdPercent,
		keepRecentTokens: configuration.keepRecentTokens,
	};
}

function copyJsonField(
	source: Record<string, unknown>,
	target: Record<string, RuntimeConfigurationJsonValue>,
	field: string,
): void {
	const value = source[field];
	if (isJsonValue(value)) target[field] = value;
}

function enrichOcrDescriptor(
	descriptor: DesktopRuntimeConfigurationEntry["descriptor"],
	providers: readonly OcrProviderDescriptor[],
): DesktopRuntimeConfigurationEntry["descriptor"] {
	return {
		...descriptor,
		presentation: {
			...(descriptor.presentation ?? {}),
			providers: providers.map((provider) => ({
				id: provider.id,
				displayName: provider.displayName,
				processing: provider.processing,
				status: provider.status,
			})),
		},
	};
}

function resolveConsumers(configurationId: string): DesktopRuntimeConfigurationConsumer[] {
	if (configurationId === CODING_AGENT_COMPACTION_CONFIGURATION_ID) {
		return [{ kind: "runtime", id: "context-compaction", support: "native" }];
	}
	if (configurationId === VETTA_OCR_CONFIGURATION.id) {
		return [
			{ kind: "tool", id: "extract_text_from_img", support: "native" },
			{ kind: "runtime", id: "plugin-ocr", support: "native" },
		];
	}
	if (configurationId !== CODING_IMAGE_CONFIGURATION.id) return [];
	return [
		{ kind: "tool", id: "read", support: "native" },
		{ kind: "runtime", id: "model-input-images", support: "native" },
	];
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
