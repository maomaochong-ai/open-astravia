import { resolve } from "node:path";
import type { HistoryEntry, ProjectInfo, SessionHistoryInfo } from "../contracts.js";

/** 进程级共享模型资源；具体 Registry 只存在于 Composition Adapter。 */
export interface RuntimeSharedModelController {
	refreshAuth(token: string | undefined): Promise<void>;
	refreshInBackground(): void;
}

/** 离线会话目录服务；不负责活动 Session 的创建、锁或生命周期。 */
export interface RuntimeSessionCatalog {
	ownsSession(sessionPath: string): Promise<boolean>;
	listProjects(): Promise<readonly ProjectInfo[]>;
	listSessions(cwd: string, sessionDir?: string): Promise<readonly SessionHistoryInfo[]>;
	renameSession(sessionPath: string, name: string): Promise<void>;
	deleteSessionArtifacts(sessionPath: string): Promise<void>;
}

/** 直接读取既有会话文件；保留当前同步 API 和不获取写锁的行为。 */
export interface RuntimeSessionFileHistoryReader {
	canRead(sessionPath: string): boolean;
	read(sessionPath: string): { history: HistoryEntry[] };
}

/** 宿主针对一个既有会话实际暴露的能力；不包含存储格式或 Backend 名称。 */
export interface RuntimeSessionAccess {
	readonly readHistory: boolean;
	readonly interactiveResume: boolean;
	readonly rename: boolean;
	readonly delete: boolean;
}

export interface RuntimeSessionAccessResolver {
	resolve(sessionPath: string): Promise<RuntimeSessionAccess | undefined>;
}

export interface RuntimeSessionAccessRoute {
	readonly catalog: RuntimeSessionCatalog;
	readonly access: RuntimeSessionAccess;
}

/** 由 Composition Root 把文件归属映射为宿主能力，Catalog 本身不决定交互策略。 */
export class CatalogRoutedRuntimeSessionAccessResolver implements RuntimeSessionAccessResolver {
	constructor(private readonly routes: readonly RuntimeSessionAccessRoute[]) {
		if (routes.length === 0) {
			throw new Error("CatalogRoutedRuntimeSessionAccessResolver requires at least one route");
		}
	}

	async resolve(sessionPath: string): Promise<RuntimeSessionAccess | undefined> {
		for (const route of this.routes) {
			if (await route.catalog.ownsSession(sessionPath)) return { ...route.access };
		}
		return undefined;
	}
}

/** 合并多个存储格式的离线目录，并按文件归属路由写操作。 */
export class CompositeRuntimeSessionCatalog implements RuntimeSessionCatalog {
	constructor(private readonly catalogs: readonly RuntimeSessionCatalog[]) {
		if (catalogs.length === 0) throw new Error("CompositeRuntimeSessionCatalog requires at least one catalog");
	}

	async ownsSession(sessionPath: string): Promise<boolean> {
		for (const catalog of this.catalogs) {
			if (await catalog.ownsSession(sessionPath)) return true;
		}
		return false;
	}

	async listProjects(): Promise<ProjectInfo[]> {
		const projectLists = await Promise.all(this.catalogs.map((catalog) => catalog.listProjects()));
		const counts = new Map<string, number>();
		for (const projects of projectLists) {
			for (const project of projects) {
				counts.set(project.cwd, (counts.get(project.cwd) ?? 0) + project.sessionCount);
			}
		}
		return Array.from(counts, ([cwd, sessionCount]) => ({ cwd, sessionCount })).sort((left, right) =>
			left.cwd.localeCompare(right.cwd),
		);
	}

	async listSessions(cwd: string, sessionDir?: string): Promise<SessionHistoryInfo[]> {
		const sessionLists = await Promise.all(this.catalogs.map((catalog) => catalog.listSessions(cwd, sessionDir)));
		const sessions = new Map<string, SessionHistoryInfo>();
		for (const list of sessionLists) {
			for (const session of list) {
				const key = resolve(session.path);
				const existing = sessions.get(key);
				if (!existing || session.modifiedAt > existing.modifiedAt) sessions.set(key, session);
			}
		}
		return Array.from(sessions.values()).sort((left, right) => right.modifiedAt - left.modifiedAt);
	}

	async renameSession(sessionPath: string, name: string): Promise<void> {
		const catalog = await this.resolveOwner(sessionPath);
		await catalog.renameSession(sessionPath, name);
	}

	async deleteSessionArtifacts(sessionPath: string): Promise<void> {
		const catalog = await this.resolveOwner(sessionPath);
		await catalog.deleteSessionArtifacts(sessionPath);
	}

	private async resolveOwner(sessionPath: string): Promise<RuntimeSessionCatalog> {
		for (const catalog of this.catalogs) {
			if (await catalog.ownsSession(sessionPath)) return catalog;
		}
		throw new Error(`No runtime session catalog owns ${sessionPath}`);
	}
}

/** 按文件格式选择同步历史读取器；不获取会话写锁。 */
export class CompositeRuntimeSessionFileHistoryReader implements RuntimeSessionFileHistoryReader {
	constructor(private readonly readers: readonly RuntimeSessionFileHistoryReader[]) {
		if (readers.length === 0) {
			throw new Error("CompositeRuntimeSessionFileHistoryReader requires at least one reader");
		}
	}

	canRead(sessionPath: string): boolean {
		return this.readers.some((reader) => reader.canRead(sessionPath));
	}

	read(sessionPath: string): { history: HistoryEntry[] } {
		const reader = this.readers.find((candidate) => candidate.canRead(sessionPath));
		if (!reader) throw new Error(`No runtime session history reader supports ${sessionPath}`);
		return reader.read(sessionPath);
	}
}
