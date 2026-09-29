export type ConfigRecord = Record<string, unknown>;

export interface VersionedConfigMigration {
	readonly fromVersion: number;
	readonly toVersion: number;
	readonly migrate: (config: ConfigRecord) => ConfigRecord;
}

export interface VersionedConfigMigrationOptions {
	readonly currentVersion: number;
	readonly initialVersion?: number;
	readonly migrations: readonly VersionedConfigMigration[];
	/** How to handle data written by a newer application version. Defaults to fail closed. */
	readonly futureVersionPolicy?: "throw" | "preserve";
}

export interface VersionedConfigMigrationResult {
	readonly config: ConfigRecord;
	readonly migrated: boolean;
}

function toConfigRecord(value: unknown): ConfigRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	return { ...(value as ConfigRecord) };
}

function getConfigVersion(config: ConfigRecord, initialVersion: number): number {
	const version = config.schemaVersion;
	if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
		return initialVersion;
	}
	return version;
}

function findNextMigration(
	migrations: readonly VersionedConfigMigration[],
	fromVersion: number,
): VersionedConfigMigration | undefined {
	return migrations.find((migration) => migration.fromVersion === fromVersion);
}

/**
 * Apply a linear chain of schemaVersion migrations (vN → vN+1 → … → current).
 * Pure function — no filesystem I/O.
 */
export function migrateVersionedConfig(
	value: unknown,
	options: VersionedConfigMigrationOptions,
): VersionedConfigMigrationResult {
	const initialVersion = options.initialVersion ?? 1;
	let config = toConfigRecord(value);
	let version = getConfigVersion(config, initialVersion);
	let migrated = false;

	while (version < options.currentVersion) {
		const migration = findNextMigration(options.migrations, version);
		if (!migration) {
			throw new Error(`Missing config migration from v${version} to v${version + 1}`);
		}
		if (migration.toVersion !== version + 1) {
			throw new Error(`Invalid config migration from v${migration.fromVersion} to v${migration.toVersion}`);
		}
		config = {
			...migration.migrate(config),
			schemaVersion: migration.toVersion,
		};
		version = migration.toVersion;
		migrated = true;
	}

	if (version > options.currentVersion) {
		if (options.futureVersionPolicy === "preserve") {
			return { config, migrated: false };
		}
		throw new Error(`Unsupported config version v${version}; current version is v${options.currentVersion}`);
	}

	return {
		config: {
			...config,
			schemaVersion: options.currentVersion,
		},
		migrated,
	};
}
