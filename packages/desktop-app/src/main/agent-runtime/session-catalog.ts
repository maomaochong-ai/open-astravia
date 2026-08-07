import { dirname, join, relative, resolve } from "node:path";
import type { ProjectInfo, RuntimeSessionCatalog, SessionHistoryInfo } from "@vetta/runtime-core";
import {
	FileConversationRuntimeSessionCatalog,
	type FileConversationRuntimeSessionCatalogOptions,
	type RuntimeConversationSessionRoot,
} from "@vetta/runtime-storage/conversation";

export interface DesktopRuntimeSessionCatalogOptions
	extends Pick<FileConversationRuntimeSessionCatalogOptions, "ownershipManager"> {
	readonly resolveRoots: () => readonly RuntimeConversationSessionRoot[];
}

/**
 * Desktop Runtime 的会话目录策略适配器。
 *
 * 文件格式识别和写操作仍由 runtime-storage 拥有；这里只补充 Desktop 动态项目根
 * 与 cwd/.vetta/sessions 默认目录，不把宿主路径规则下沉到存储包。
 */
export class DesktopRuntimeSessionCatalog implements RuntimeSessionCatalog {
	private readonly catalog: FileConversationRuntimeSessionCatalog;

	constructor(private readonly options: DesktopRuntimeSessionCatalogOptions) {
		this.catalog = new FileConversationRuntimeSessionCatalog({
			ownershipManager: options.ownershipManager,
		});
	}

	ownsSession(sessionPath: string): Promise<boolean> {
		return this.catalog.ownsSession(sessionPath);
	}

	listProjects(): Promise<readonly ProjectInfo[]> {
		return this.catalogForCurrentRoots().listProjects();
	}

	listSessions(cwd: string, sessionDir?: string): Promise<readonly SessionHistoryInfo[]> {
		return this.catalog.listSessions(cwd, sessionDir ?? join(resolve(cwd), ".vetta", "sessions"));
	}

	renameSession(sessionPath: string, name: string): Promise<void> {
		return this.catalog.renameSession(sessionPath, name);
	}

	deleteSessionArtifacts(sessionPath: string): Promise<void> {
		return this.catalog.deleteSessionArtifacts(sessionPath);
	}

	private catalogForCurrentRoots(): FileConversationRuntimeSessionCatalog {
		return new FileConversationRuntimeSessionCatalog({
			roots: deduplicateRoots(this.options.resolveRoots()),
			ownershipManager: this.options.ownershipManager,
		});
	}
}

/** 只改变路由认领范围，不复制 Catalog 的目录与写操作实现。 */
export class PathFilteredRuntimeSessionCatalog implements RuntimeSessionCatalog {
	constructor(
		private readonly catalog: RuntimeSessionCatalog,
		private readonly acceptsPath: (sessionPath: string) => boolean,
	) {}

	async ownsSession(sessionPath: string): Promise<boolean> {
		return this.acceptsPath(sessionPath) && (await this.catalog.ownsSession(sessionPath));
	}

	listProjects(): Promise<readonly ProjectInfo[]> {
		return this.catalog.listProjects();
	}

	listSessions(cwd: string, sessionDir?: string): Promise<readonly SessionHistoryInfo[]> {
		return this.catalog.listSessions(cwd, sessionDir);
	}

	renameSession(sessionPath: string, name: string): Promise<void> {
		return this.catalog.renameSession(sessionPath, name);
	}

	deleteSessionArtifacts(sessionPath: string): Promise<void> {
		return this.catalog.deleteSessionArtifacts(sessionPath);
	}
}

export function isSessionPathInDirectory(sessionPath: string, sessionDir: string): boolean {
	return resolve(dirname(sessionPath)) === resolve(sessionDir);
}

function deduplicateRoots(roots: readonly RuntimeConversationSessionRoot[]): RuntimeConversationSessionRoot[] {
	const unique = new Map<string, RuntimeConversationSessionRoot>();
	for (const root of roots) {
		const cwd = resolve(root.cwd);
		const sessionDir = resolve(root.sessionDir);
		const relativeSessionDir = relative(cwd, sessionDir);
		const key = `${cwd}\0${relativeSessionDir}`;
		unique.set(key, { cwd, sessionDir });
	}
	return [...unique.values()];
}
