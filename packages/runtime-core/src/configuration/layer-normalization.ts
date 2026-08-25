import type { RuntimeConfigurationJsonObject, RuntimeConfigurationLayerSnapshot } from "./contracts.js";
import { invalidRuntimeConfigurationLayerError } from "./errors.js";
import { cloneAndFreezeConfigurationObject, isRuntimeConfigurationJsonObject } from "./json.js";

/** 发布与解析边界共享同一份 Layer 结构校验，避免并行事实源。 */
export function normalizeRuntimeConfigurationLayers(
	layers: readonly RuntimeConfigurationLayerSnapshot[],
): readonly RuntimeConfigurationLayerSnapshot[] {
	if (!Array.isArray(layers)) {
		throw invalidRuntimeConfigurationLayerError("Runtime Configuration layers must be an array");
	}
	const ids = new Set<string>();
	const precedences = new Set<number>();
	const normalized = layers.map((layer) => {
		if (!layer || typeof layer !== "object") {
			throw invalidRuntimeConfigurationLayerError("Runtime Configuration layer must be an object");
		}
		assertLayerId(layer.id, "id");
		assertLayerId(layer.revision, "revision");
		if (ids.has(layer.id)) {
			throw invalidRuntimeConfigurationLayerError(`Duplicate Runtime Configuration layer id: ${layer.id}`);
		}
		if (!Number.isSafeInteger(layer.precedence)) {
			throw invalidRuntimeConfigurationLayerError(
				`Runtime Configuration layer ${layer.id} precedence must be a safe integer`,
			);
		}
		if (precedences.has(layer.precedence)) {
			throw invalidRuntimeConfigurationLayerError(
				`Duplicate Runtime Configuration layer precedence: ${layer.precedence}`,
			);
		}
		if (!layer.values || typeof layer.values !== "object" || Array.isArray(layer.values)) {
			throw invalidRuntimeConfigurationLayerError(
				`Runtime Configuration layer ${layer.id} values must be an object`,
			);
		}
		ids.add(layer.id);
		precedences.add(layer.precedence);
		const values: Record<string, RuntimeConfigurationJsonObject> = {};
		for (const [configurationId, value] of Object.entries(layer.values)) {
			assertLayerId(configurationId, "configuration id");
			if (!isRuntimeConfigurationJsonObject(value)) {
				throw invalidRuntimeConfigurationLayerError(
					`Runtime Configuration layer ${layer.id} value for ${configurationId} must be a JSON object`,
				);
			}
			values[configurationId] = cloneAndFreezeConfigurationObject(value);
		}
		return Object.freeze({
			id: layer.id,
			revision: layer.revision,
			precedence: layer.precedence,
			values: Object.freeze(values),
		});
	});
	return Object.freeze(normalized.sort((left, right) => left.precedence - right.precedence));
}

function assertLayerId(value: string, label: string): void {
	if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
		throw invalidRuntimeConfigurationLayerError(
			`Runtime Configuration layer ${label} must be a non-empty trimmed string`,
		);
	}
}
