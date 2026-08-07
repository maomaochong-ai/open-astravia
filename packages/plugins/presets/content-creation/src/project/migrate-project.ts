import type { ConfigRecord } from "@vetta/toolkit/versioned-config";
import { resolveContentProjectRuntime } from "./legacy-runtime";
import { migrateContentProjectConfig } from "./migrate-config";
import { hydrateContentProject, isContentProjectFile } from "./persistence";
import type { ContentProjectDocument } from "./types";

export interface ContentProjectMigrationResult {
	project: ContentProjectDocument;
	migrated: boolean;
}

export function migrateContentProjectDocument(
	value: unknown,
	runtimeValue: unknown,
	cwd: string | null,
): ContentProjectMigrationResult | null {
	if (!isRecord(value)) return null;
	let migration;
	try {
		migration = migrateContentProjectConfig(value);
	} catch {
		return null;
	}
	if (!isContentProjectFile(migration.config)) return null;

	const runtimeResult = resolveContentProjectRuntime(
		runtimeValue,
		value,
		migration.config.projectId,
		migration.config.updatedAt,
	);
	return {
		migrated: migration.migrated || runtimeResult.migrated,
		project: hydrateContentProject(migration.config, cwd, runtimeResult.runtime),
	};
}

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
