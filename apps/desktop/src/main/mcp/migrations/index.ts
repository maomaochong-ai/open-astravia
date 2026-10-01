import { getAstraviaHomePath } from "@astravia/action-rpc";
import { runFileMigrations } from "@astravia/toolkit/file-migrations";
import { removeRetiredBuiltinMcpServersMigration } from "./001_remove_retired_builtin_servers.js";

const MCP_FILE_MIGRATIONS = [removeRetiredBuiltinMcpServersMigration] as const;

let migrationPromise: Promise<void> | undefined;

export function ensureMcpFileMigrations(): Promise<void> {
	migrationPromise ??= runFileMigrations({
		root: getAstraviaHomePath(),
		migrations: MCP_FILE_MIGRATIONS,
		statePath: "agent/mcp-migrations.json",
	}).then(() => undefined);
	return migrationPromise;
}
