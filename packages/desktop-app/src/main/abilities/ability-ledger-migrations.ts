import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";

export const ABILITY_LEDGER_SCHEMA_VERSION = 2;

export function migrateAbilityLedgerConfig(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: ABILITY_LEDGER_SCHEMA_VERSION,
		migrations: [
			{
				fromVersion: 1,
				toVersion: 2,
				migrate(config) {
					const { schemaVersion: _schemaVersion, ...entries } = config;
					return { entries };
				},
			},
		],
	});
}
