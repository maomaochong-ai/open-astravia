import type { SettingsDocument } from "../contracts/settings-document.js";

export interface SettingsChange {
	readonly field: keyof SettingsDocument;
	readonly nestedFields?: ReadonlySet<string>;
}

export function createSettingsChangeSet(patch: Partial<SettingsDocument>): SettingsChange[] {
	return (Object.keys(patch) as (keyof SettingsDocument)[]).map((field) => {
		const value = patch[field];
		return isNestedSettingsValue(value) ? { field, nestedFields: new Set(Object.keys(value)) } : { field };
	});
}

function isNestedSettingsValue(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
