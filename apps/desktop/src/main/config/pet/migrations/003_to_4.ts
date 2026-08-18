import type { VersionedConfigMigration } from "@vetta/toolkit/versioned-config";

export const petConfigMigration003To4: VersionedConfigMigration = {
	fromVersion: 3,
	toVersion: 4,
	migrate(config) {
		const nextConfig = { ...config };
		delete nextConfig.defaultActionId;
		return nextConfig;
	},
};
