// Imports historical session data before handing ownership to the production Runtime.
import { dirname, resolve } from "node:path";
import {
	type CodingAgentHistoricalSessionMigrationIncompatible,
	migrateCodingAgentHistoricalSession,
} from "@vetta/coding-agent/historical-sessions";
import type {
	RuntimeHostSessionAssembly,
	RuntimeHostSessionBackend,
	RuntimeSessionCreateRequest,
} from "@vetta/runtime-core";

export class DesktopHistoricalSessionImportError extends Error {
	constructor(readonly incompatibility: CodingAgentHistoricalSessionMigrationIncompatible) {
		super(`${incompatibility.errorCode}: Historical session cannot be imported safely`);
		this.name = "DesktopHistoricalSessionImportError";
	}
}

/** Imports historical session data before opening it with the production Runtime. */
export class DesktopHistoricalSessionImportBackend implements RuntimeHostSessionBackend {
	constructor(private readonly targetBackend: RuntimeHostSessionBackend) {}

	async createAssembly(request: RuntimeSessionCreateRequest): Promise<RuntimeHostSessionAssembly> {
		const sourcePath = request.sessionPath?.trim();
		if (!sourcePath) throw new Error("Historical session import requires a source path");
		const targetRootDir = resolve(request.sessionDir ?? dirname(sourcePath));
		const migration = await migrateCodingAgentHistoricalSession(sourcePath, targetRootDir);
		if (migration.kind === "session-incompatible") {
			throw new DesktopHistoricalSessionImportError(migration);
		}
		return this.targetBackend.createAssembly({
			...request,
			sessionPath: migration.targetPath,
			sessionDir: targetRootDir,
		});
	}
}
