import type { ConfigRecord } from "@vetta/toolkit/versioned-config";
import { contentNodeStatusFromRuntime, resolveContentProjectRuntime } from "./legacy-runtime";
import { migrateContentProjectConfig } from "./migrate-config";
import { isContentProjectFile } from "./persistence";
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
		project: {
			...structuredClone(migration.config),
			cwd,
			graph: {
				...structuredClone(migration.config.graph),
				nodes: migration.config.graph.nodes.map((node) => ({
					...structuredClone(node),
					status: contentNodeStatusFromRuntime(runtimeResult.runtime, node.id),
				})),
			},
			jobs: structuredClone(runtimeResult.runtime.jobs),
		},
	};
}

function isRecord(value: unknown): value is ConfigRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
