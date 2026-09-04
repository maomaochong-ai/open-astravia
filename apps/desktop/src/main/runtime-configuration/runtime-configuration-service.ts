import { createHash } from "node:crypto";
import {
	projectRuntimeConfigurationCatalog,
	RuntimeConfigurationCenter,
	type RuntimeConfigurationJsonObject,
	type RuntimeConfigurationJsonValue,
} from "@vetta/runtime-core/configuration";
import { CODING_IMAGE_CONFIGURATION } from "@vetta/runtime-tools";
import type {
	DesktopRuntimeConfigurationCatalog,
	DesktopRuntimeConfigurationConsumer,
	DesktopRuntimeConfigurationEntry,
} from "../../preload/api.js";

const BUILTIN_DEFINITION_SOURCE = { id: "runtime-tools", revision: "coding-images-v1" } as const;
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
								consumers: Object.freeze(resolveConsumers(entry.configurationId)),
							}),
					),
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
		if (configurationId !== CODING_IMAGE_CONFIGURATION.id) {
			throw new Error(`Runtime Configuration is not editable: ${configurationId}`);
		}
		const definitionLease = this.center.definitions.acquire(configurationId);
		let decoded: RuntimeConfigurationJsonObject;
		try {
			const definition = definitionLease.revision.definition;
			const current = this.readPersistedValue();
			decoded = definition.codec.decode(mergeObjects(mergeObjects(definition.defaultValue, current), patch));
		} finally {
			await definitionLease.release();
		}

		this.dependencies.updateAgentSettings((settings) => {
			settings.images = decoded;
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
				definition: CODING_IMAGE_CONFIGURATION,
			});
			this.builtinPublished = true;
		}

		const values: Record<string, RuntimeConfigurationJsonObject> = {};
		const images = this.dependencies.readAgentSettings().images;
		if (isRecord(images)) values[CODING_IMAGE_CONFIGURATION.id] = toJsonObject(images);
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

	private readPersistedValue(): RuntimeConfigurationJsonObject {
		const images = this.dependencies.readAgentSettings().images;
		return isRecord(images) ? toJsonObject(images) : {};
	}
}

function resolveConsumers(configurationId: string): DesktopRuntimeConfigurationConsumer[] {
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
