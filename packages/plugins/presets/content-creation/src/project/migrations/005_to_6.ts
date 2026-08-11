import type { ConfigRecord, VersionedConfigMigration } from "@vetta/toolkit/versioned-config";

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Existing positions are user-owned so upgrading never opts an established canvas into automatic movement. */
export const contentProjectMigration005To6: VersionedConfigMigration = {
	fromVersion: 5,
	toVersion: 6,
	migrate(config) {
		const view = isRecord(config.view) ? config.view : {};
		const nodes = isRecord(view.nodes) ? view.nodes : {};
		return {
			...config,
			schemaVersion: 6,
			view: {
				...view,
				nodes: Object.fromEntries(
					Object.entries(nodes).map(([nodeId, value]) => [
						nodeId,
						isRecord(value) ? { ...value, layoutOwnership: "user" } : value,
					]),
				),
			},
		};
	},
};
