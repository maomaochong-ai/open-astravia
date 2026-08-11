import type { ConfigRecord, VersionedConfigMigration } from "@vetta/toolkit/versioned-config";

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): ConfigRecord {
	return isRecord(value) ? value : {};
}

function migrateNodes(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	const ordinals = new Map<string, number>();
	return value.map((item) => {
		if (!isRecord(item)) return item;
		const kind = typeof item.kind === "string" ? item.kind : "node";
		const ordinal = (ordinals.get(kind) ?? 0) + 1;
		ordinals.set(kind, ordinal);
		const data = asRecord(item.data);
		const label = typeof data.label === "string" ? data.label.trim() : "";
		const { label: _label, ...nextData } = data;
		const { status: _status, ...node } = item;
		return { ...node, name: label || `${kind} ${ordinal}`, data: nextData };
	});
}

export const contentProjectMigration002To3: VersionedConfigMigration = {
	fromVersion: 2,
	toVersion: 3,
	migrate(config) {
		const { cwd: _cwd, jobs: _jobs, ...document } = config;
		const graph = asRecord(config.graph);
		return {
			...document,
			graph: { ...graph, nodes: migrateNodes(graph.nodes) },
		};
	},
};
