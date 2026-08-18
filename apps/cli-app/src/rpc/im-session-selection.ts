import type { RuntimeSessionCatalog, SessionHistoryInfo } from "@vetta/runtime-core";

export interface ResolveImSessionPathOptions {
	readonly explicitSessionPath?: string;
	readonly continueSession: boolean;
	readonly cwd: string;
	readonly sessionDir: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
}

/**
 * 将 CLI 的确定性会话参数解析为文件路径。
 *
 * 格式归属仍由各 Catalog 判断；这里不读取或解析任何持久化文件。
 */
export async function resolveImSessionPath(options: ResolveImSessionPathOptions): Promise<string | undefined> {
	if (options.explicitSessionPath || !options.continueSession) return options.explicitSessionPath;
	const sessions = await options.sessionCatalog.listSessions(options.cwd, options.sessionDir);
	return selectMostRecentSession(sessions)?.path;
}

function selectMostRecentSession(sessions: readonly SessionHistoryInfo[]): SessionHistoryInfo | undefined {
	let mostRecent: SessionHistoryInfo | undefined;
	for (const session of sessions) {
		if (
			!mostRecent ||
			session.modifiedAt > mostRecent.modifiedAt ||
			(session.modifiedAt === mostRecent.modifiedAt && session.path.localeCompare(mostRecent.path) < 0)
		) {
			mostRecent = session;
		}
	}
	return mostRecent;
}
