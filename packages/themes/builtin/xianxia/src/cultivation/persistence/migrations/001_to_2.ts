import type { ConfigRecord, VersionedConfigMigration } from "@astravia/toolkit/versioned-config";

/** Legacy v1 → v2: preserve the loosely shaped early snapshot. */
export const cultivationMigration001To2: VersionedConfigMigration = {
	fromVersion: 1,
	toVersion: 2,
	migrate(config) {
		return { ...config } satisfies ConfigRecord;
	},
};
