import type {
	RuntimeConfigurationCatalogEntry,
	RuntimeConfigurationCatalogSnapshot,
	RuntimeConfigurationJsonObject,
	RuntimeConfigurationJsonValue,
	RuntimeConfigurationSnapshot,
} from "./contracts.js";

type MutableConfigurationJsonValue =
	| null
	| string
	| number
	| boolean
	| MutableConfigurationJsonValue[]
	| { [key: string]: MutableConfigurationJsonValue };

/** 将执行快照投影为不含敏感值的可序列化目录，供 Host/IPC/UI 复用。 */
export function projectRuntimeConfigurationCatalog(
	snapshot: RuntimeConfigurationSnapshot,
): RuntimeConfigurationCatalogSnapshot {
	const entries = snapshot.entries.map((entry): RuntimeConfigurationCatalogEntry => {
		const sensitivePaths = entry.descriptor.sensitivePaths ?? [];
		return Object.freeze({
			configurationId: entry.configurationId,
			definitionRevisionId: entry.definitionRevisionId,
			definitionSourceId: entry.definitionSourceId,
			schemaVersion: entry.schemaVersion,
			apply: entry.apply,
			descriptor: entry.descriptor,
			defaultValue: redactConfigurationObject(entry.defaultValue, sensitivePaths),
			value: redactConfigurationObject(entry.value, sensitivePaths),
			redactedPaths: Object.freeze([...sensitivePaths]),
			appliedLayerIds: entry.appliedLayerIds,
			diagnostics: Object.freeze(
				snapshot.diagnostics.filter(({ configurationId }) => configurationId === entry.configurationId),
			),
		});
	});
	return Object.freeze({
		snapshotId: snapshot.id,
		definitionVersion: snapshot.definitionVersion,
		entries: Object.freeze(entries),
	});
}

export function redactConfigurationObject(
	value: RuntimeConfigurationJsonObject,
	sensitivePaths: readonly string[],
): RuntimeConfigurationJsonObject {
	const result = cloneJson(value) as Record<string, MutableConfigurationJsonValue>;
	for (const pointer of sensitivePaths) removeJsonPointer(result, pointer);
	return deepFreeze(result);
}

function removeJsonPointer(root: Record<string, MutableConfigurationJsonValue>, pointer: string): void {
	const segments = pointer
		.slice(1)
		.split("/")
		.map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
	if (segments.length === 0 || segments[0] === "") return;
	let parent: MutableConfigurationJsonValue = root;
	for (const segment of segments.slice(0, -1)) {
		if (!isMutableRecord(parent)) return;
		const next: MutableConfigurationJsonValue | undefined = parent[segment];
		if (next === undefined) return;
		parent = next;
	}
	if (isMutableRecord(parent)) delete parent[segments.at(-1)!];
}

function cloneJson(value: RuntimeConfigurationJsonValue): MutableConfigurationJsonValue {
	if (Array.isArray(value)) return value.map(cloneJson);
	if (!isMutableRecord(value)) return value as null | string | number | boolean;
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
}

function deepFreeze<T extends RuntimeConfigurationJsonValue>(value: T): T {
	if (Array.isArray(value)) {
		for (const item of value) deepFreeze(item);
		return Object.freeze(value) as T;
	}
	if (isMutableRecord(value)) {
		for (const item of Object.values(value)) deepFreeze(item);
		return Object.freeze(value) as T;
	}
	return value;
}

function isMutableRecord(value: unknown): value is Record<string, MutableConfigurationJsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
