import type { PluginWorkspaceRoot } from "@astravia-org/plugin-sdk";
import { type StatusSlice, buildStatusCodes, normalizeFsPath, normalizeRepoPrefix } from "./statusBadges";
import type { ChangeCode, StatusGroups } from "./types";

/** 一个工作区根对应的仓库信息，`repoPrefix` 是该根在仓库内的相对前缀。 */
export interface RepoAnchor {
	root: string;
	prefix: string;
}

export interface StatusRefresherDeps {
	listRoots(): readonly PluginWorkspaceRoot[];
	resolveRepo(cwd: string): Promise<RepoAnchor | null>;
	readStatus(repoRoot: string): Promise<StatusGroups>;
	applySlices(slices: readonly StatusSlice[]): void;
	/** 连续编辑（保存、批量改名、checkout）时把多次 `git status` 合并成一次。 */
	debounceMs?: number;
}

export interface StatusRefresher {
	/** 合并窗口后刷新一次。文件系统事件与面板动作都走这里。 */
	schedule(): void;
	/** 立刻刷新，跳过等待窗口。 */
	refresh(): Promise<void>;
	dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * 后台维护文件树状态标记的数据源。
 *
 * 一次刷新 = 列出工作区根 → 各自解析仓库根与前缀 → 每个仓库读一次 `git status`
 * （同一仓库下的多个根共用一份结果）。宿主渲染行时只查内存索引，不会因为展开目录而跑命令。
 */
export function createStatusRefresher(deps: StatusRefresherDeps): StatusRefresher {
	const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let running: Promise<void> | null = null;
	let queued = false;
	let disposed = false;
	/** 上一次的快照，按工作区根索引；读失败时用它兜底。 */
	let previous = new Map<string, StatusSlice>();

	const collect = async (): Promise<StatusSlice[]> => {
		const anchors = new Map<string, RepoAnchor>();
		for (const root of deps.listRoots()) {
			const anchor = await deps.resolveRepo(root.path);
			if (anchor) anchors.set(normalizeFsPath(root.path), { ...anchor, root: normalizeFsPath(anchor.root) });
		}

		const codesByRepo = new Map<string, ReadonlyMap<string, ChangeCode> | null>();
		for (const repo of new Set([...anchors.values()].map((anchor) => anchor.root))) {
			try {
				codesByRepo.set(repo, buildStatusCodes(await deps.readStatus(repo)));
			} catch {
				// git 没装、索引被锁、仓库刚被移走：标记为没读到，下面沿用上一次的结果，
				// 比因为一次瞬时失败把整棵树的标记闪没要好。
				codesByRepo.set(repo, null);
			}
		}

		const next: StatusSlice[] = [];
		for (const [workspaceRoot, anchor] of anchors) {
			const codes = codesByRepo.get(anchor.root);
			if (codes) {
				next.push({ workspaceRoot, codes, repoPrefix: normalizeRepoPrefix(anchor.prefix) });
				continue;
			}
			const stale = previous.get(workspaceRoot);
			if (stale) next.push(stale);
			else next.push({ workspaceRoot, codes: new Map(), repoPrefix: normalizeRepoPrefix(anchor.prefix) });
		}
		// 已经消失的根不再保留，避免旧标记一直挂在新项目上。
		previous = new Map(next.map((slice) => [normalizeFsPath(slice.workspaceRoot), slice]));
		return next;
	};

	const run = (): Promise<void> => {
		if (running) {
			queued = true;
			return running;
		}
		running = (async () => {
			try {
				deps.applySlices(await collect());
			} catch (error) {
				console.warn("[git] 刷新文件状态标记失败", error);
			} finally {
				running = null;
				if (queued && !disposed) {
					queued = false;
					void run();
				}
			}
		})();
		return running;
	};

	return {
		schedule: () => {
			if (disposed) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				void run();
			}, debounceMs);
		},
		refresh: () => {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			return run();
		},
		dispose: () => {
			disposed = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		},
	};
}
