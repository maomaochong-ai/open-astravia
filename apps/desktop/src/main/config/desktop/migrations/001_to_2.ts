import type { ConfigRecord, VersionedConfigMigration } from "@vetta/toolkit/versioned-config";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "../../../../shared/notification-preferences.js";

export const migrateDesktopConfigV1ToV2: VersionedConfigMigration = {
	fromVersion: 1,
	toVersion: 2,
	migrate(config: ConfigRecord): ConfigRecord {
		return {
			...config,
			notificationPreferences: config.notificationPreferences ?? DEFAULT_NOTIFICATION_PREFERENCES,
		};
	},
};
