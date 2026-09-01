import { getVettaHomePath } from "@vetta/action-rpc";
import { runFileMigrations } from "@vetta/toolkit/file-migrations";
import { removeRetiredBuiltinMcpServersMigration } from "./001_remove_retired_builtin_servers.js";

const MCP_FILE_MIGRATIONS = [removeRetiredBuiltinMcpServersMigration] as const;

let migrationPromise: Promise<void> | undefined;

export function ensureMcpFileMigrations(): Promise<void> {
	migrationPromise ??= runFileMigrations({
		root: getVettaHomePath(),
		migrations: MCP_FILE_MIGRATIONS,
		statePath: "agent/mcp-migrations.json",
	}).then(() => undefined);
	return migrationPromise;
}
