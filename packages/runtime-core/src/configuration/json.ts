import type { RuntimeConfigurationJsonObject, RuntimeConfigurationJsonValue } from "./contracts.js";

export function cloneAndFreezeConfigurationObject<TValue extends RuntimeConfigurationJsonObject>(
	value: TValue,
): TValue {
	return deepFreeze(structuredClone(value), new WeakSet<object>());
}

export function isRuntimeConfigurationJsonObject(value: unknown): value is RuntimeConfigurationJsonObject {
	return isJsonObject(value, new WeakSet<object>());
}

export function mergeRuntimeConfigurationObjects(
	base: RuntimeConfigurationJsonObject,
	override: RuntimeConfigurationJsonObject,
): RuntimeConfigurationJsonObject {
	const result: Record<string, RuntimeConfigurationJsonValue> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = result[key];
		result[key] =
			isPlainJsonObject(current) && isPlainJsonObject(value)
				? mergeRuntimeConfigurationObjects(current, value)
				: value;
	}
	return result;
}

function isJsonObject(value: unknown, seen: WeakSet<object>): value is RuntimeConfigurationJsonObject {
	if (!isPlainRecord(value) || seen.has(value)) return false;
	seen.add(value);
	for (const child of Object.values(value)) {
		if (!isJsonValue(child, seen)) return false;
	}
	seen.delete(value);
	return true;
}

function isJsonValue(value: unknown, seen: WeakSet<object>): value is RuntimeConfigurationJsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) {
		if (seen.has(value)) return false;
		seen.add(value);
		const valid = value.every((child) => isJsonValue(child, seen));
		seen.delete(value);
		return valid;
	}
	return isJsonObject(value, seen);
}

function isPlainJsonObject(value: RuntimeConfigurationJsonValue | undefined): value is RuntimeConfigurationJsonObject {
	return isPlainRecord(value);
}

function isPlainRecord(value: unknown): value is Record<string, RuntimeConfigurationJsonValue> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T, seen: WeakSet<object>): T {
	if (typeof value !== "object" || value === null || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value)) deepFreeze(child, seen);
	return Object.freeze(value);
}
