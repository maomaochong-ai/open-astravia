import type { ConfigRecord, VersionedConfigMigration } from "@vetta/toolkit/versioned-config";

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateLegacyAsset(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const { url: _url, ...asset } = value;
	return {
		...asset,
		blobId: typeof value.blobId === "string" ? value.blobId : value.id,
	};
}

export const contentProjectMigration001To2: VersionedConfigMigration = {
	fromVersion: 1,
	toVersion: 2,
	migrate(config) {
		return {
			...config,
			assets: Array.isArray(config.assets) ? config.assets.map(migrateLegacyAsset) : config.assets,
		};
	},
};
