import { dirname, relative, resolve } from "node:path";
import type { ProjectInfo, RuntimeSessionCatalog, SessionHistoryInfo } from "@vetta/runtime-core";
import {
	FileConversationRuntimeSessionCatalog,
	type FileConversationRuntimeSessionCatalogOptions,
	type RuntimeConversationSessionRoot,
} from "@vetta/runtime-storage/conversation";

export interface DesktopRuntimeSessionCatalogOptions
	extends Pick<FileConversationRuntimeSessionCatalogOptions, "artifactCleaner" | "ownershipManager"> {
	readonly resolveRoots: () => readonly RuntimeConversationSessionRoot[];
}

/**
 * Desktop Runtime 的会话目录策略适配器。
 *
 * 文件格式识别和写操作仍由 runtime-storage 拥有；这里只补充 Desktop 的动态项目根，
 * 不把宿主路径规则下沉到存储包。
 */
export class DesktopRuntimeSessionCatalog implements RuntimeSessionCatalog {
	private readonly catalog: FileConversationRuntimeSessionCatalog;

	constructor(private readonly options: DesktopRuntimeSessionCatalogOptions) {
		this.catalog = new FileConversationRuntimeSessionCatalog({
			artifactCleaner: options.artifactCleaner,
			ownershipManager: options.ownershipManager,
		});
	}

	ownsSession(sessionPath: string): Promise<boolean> {
		return this.catalog.ownsSession(sessionPath);
	}

	listProjects(): Promise<readonly ProjectInfo[]> {
		return this.catalogForCurrentRoots().listProjects();
	}

	/**
	 * 不给 `sessionDir` 兜底：底层 catalog 在缺省时会**并集**同一 cwd 的全部已注册 root，
	 * 于是新会话（全局分片目录）与存量会话（`<项目>/.vetta/sessions`）能一起列出来。
	 * 一旦在这里钉死某一个目录，另一处的会话就从列表里消失了。
	 *
	 * 走 {@link catalogForCurrentRoots}（而不是构造时那份无 root 的 catalog）：项目列表
	 * 是动态的，缺省并集必须基于**当前**已注册的 root。
	 */
	listSessions(cwd: string, sessionDir?: string): Promise<readonly SessionHistoryInfo[]> {
		return this.catalogForCurrentRoots().listSessions(cwd, sessionDir);
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
			artifactCleaner: this.options.artifactCleaner,
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
