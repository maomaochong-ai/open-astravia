import type { SettingsDocument } from "../contracts/settings-document.js";

export function mergeSettings(base: SettingsDocument, overrides: SettingsDocument): SettingsDocument {
	const result: SettingsDocument = { ...base };
	for (const key of Object.keys(overrides) as (keyof SettingsDocument)[]) {
		const overrideValue = overrides[key];
		if (overrideValue === undefined) continue;
		const baseValue = base[key];
		if (isMergeableObject(overrideValue) && isMergeableObject(baseValue)) {
			(result as Record<string, unknown>)[key] = { ...baseValue, ...overrideValue };
		} else {
			(result as Record<string, unknown>)[key] = overrideValue;
		}
	}
	return result;
}

export function applySettingsPatch(current: SettingsDocument, patch: Partial<SettingsDocument>): SettingsDocument {
	const result = structuredClone(current);
	for (const key of Object.keys(patch) as (keyof SettingsDocument)[]) {
		const value = patch[key];
		const currentValue = current[key];
		if (isMergeableObject(value) && isMergeableObject(currentValue)) {
			(result as Record<string, unknown>)[key] = { ...currentValue, ...value };
		} else {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

function isMergeableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
