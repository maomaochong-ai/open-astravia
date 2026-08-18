import { i18n } from "@shared/i18n";
import type {
	KnowledgeBase,
	KnowledgeFileStatus,
	KnowledgeNode,
	KnowledgeProcessStatus,
} from "@shared/types/knowledge-base";

/**
 * 解析单文件加工态。map 无条目时返回 null（尚未加载 / 尚未纳入），
 * 不得默认成 "unprocessed"——否则首屏会在真实状态回填前误灰显整表。
 */
export function resolveKnowledgeFileStatus(
	fileStatuses: Record<string, KnowledgeFileStatus>,
	kbId: string,
	nodeId: string,
): KnowledgeProcessStatus | null {
	return fileStatuses[`${kbId}/${nodeId}`]?.status ?? null;
}

/**
 * 页面级文件区骨架（仅挡「还没有任何库列表」的首载）。
 * 注意：不得因深层懒加载出文件、或加工态未回填而卸载内容面板——
 * 否则 path 等本地 state 会丢失，表现为进第二层加载完又弹回根层。
 */
export function shouldShowKnowledgeFilesSkeleton(opts: { listLoading: boolean; basesEmpty: boolean }): boolean {
	return opts.listLoading && opts.basesEmpty;
}

/**
 * 当前层是否应等加工态再渲染文件 item（避免缺 status 时误灰）。
 * 只看**当前层**已加载节点里是否有文件，不递归子目录（子目录进入时 statuses 通常已 hydrated）。
 */
export function shouldHoldForStatuses(opts: {
	statusesHydrated: boolean;
	levelNodes: KnowledgeNode[] | null;
}): boolean {
	if (opts.statusesHydrated) return false;
	if (!opts.levelNodes) return false;
	return opts.levelNodes.some((node) => node.type === "file");
}

/**
 * 目录层是否已拉取（或无需再拉）：
 * - relPath 空串 = 库根（list 已给，恒 true）
 * - 路径上某段目录不存在于父层 = 视为无需再拉（避免对已删路径死循环 listDir）
 * - 否则要求该目录 children !== undefined
 */
export function isKnowledgeDirLoaded(nodes: KnowledgeNode[], relPath: string): boolean {
	if (!relPath) return true;
	const segments = relPath.split("/").filter(Boolean);
	let current = nodes;
	for (const seg of segments) {
		const dir = current.find((node) => node.type === "directory" && node.name === seg);
		if (!dir) return true;
		if (dir.children === undefined) return false;
		current = dir.children;
	}
	return true;
}

/**
 * 把某一层 children 写回树：relPath 空串替换库根 nodes；否则挂到对应目录下。
 * 已加载的更深层 children 若同名则尽量保留（避免进子目录后刷新父层丢缓存）。
 */
export function mergeKnowledgeDirChildren(
	nodes: KnowledgeNode[],
	relPath: string,
	children: KnowledgeNode[],
): KnowledgeNode[] {
	if (!relPath) return mergePreserveLoadedChildren(nodes, children);

	const segments = relPath.split("/").filter(Boolean);
	const mergeAt = (list: KnowledgeNode[], depth: number): KnowledgeNode[] => {
		const name = segments[depth];
		return list.map((node) => {
			if (node.type !== "directory" || node.name !== name) return node;
			if (depth === segments.length - 1) {
				return {
					...node,
					children: mergePreserveLoadedChildren(node.children, children),
					childCount: children.length,
				};
			}
			if (node.children === undefined) return node;
			return { ...node, children: mergeAt(node.children, depth + 1) };
		});
	};
	return mergeAt(nodes, 0);
}

/** 新列表覆盖同层；同 id 目录若旧树已加载 children 则保留（新列表 children 多为 undefined）。 */
function mergePreserveLoadedChildren(previous: KnowledgeNode[] | undefined, next: KnowledgeNode[]): KnowledgeNode[] {
	if (!previous?.length) return next;
	const prevById = new Map(previous.map((n) => [n.id, n]));
	return next.map((node) => {
		if (node.type !== "directory") return node;
		const old = prevById.get(node.id);
		if (old?.type === "directory" && old.children !== undefined && node.children === undefined) {
			return { ...node, children: old.children, childCount: node.childCount ?? old.childCount };
		}
		return node;
	});
}

/** 默认库的磁盘名是语言无关的 "default_kb"，UI 显示走 i18n；其余库用磁盘原名。 */
export function knowledgeBaseDisplayName(base: Pick<KnowledgeBase, "name" | "isDefault">): string {
	return base.isDefault ? i18n.t("settings:kbDefaultName") : base.name;
}

export interface KnowledgeNodeStats {
	files: number;
	directories: number;
}

/** 仅统计已加载层（懒加载下不全树；全库文件数请用 countKnowledgeFilesFromStatuses）。 */
export function countKnowledgeNodes(nodes: KnowledgeNode[]): KnowledgeNodeStats {
	let files = 0;
	let directories = 0;
	for (const node of nodes) {
		if (node.type === "file") {
			files += 1;
			continue;
		}
		directories += 1;
		if (node.children !== undefined) {
			const nested = countKnowledgeNodes(node.children);
			files += nested.files;
			directories += nested.directories;
		}
	}
	return { files, directories };
}

/**
 * 从加工态 map 统计某库文件总数（source_path 前缀 `${kbId}/`）。
 * 懒加载树不全时用于列表卡 / 切换器上的文件数。
 */
export function countKnowledgeFilesFromStatuses(
	kbId: string,
	fileStatuses: Record<string, KnowledgeFileStatus>,
): number {
	const prefix = `${kbId}/`;
	let n = 0;
	for (const key of Object.keys(fileStatuses)) {
		if (key.startsWith(prefix)) n += 1;
	}
	return n;
}

/**
 * 从加工态路径推导目录数（文件父路径去重）+ 根层已见但无文件的空目录。
 */
export function countKnowledgeDirsFromStatuses(
	kbId: string,
	fileStatuses: Record<string, KnowledgeFileStatus>,
	rootNodes: KnowledgeNode[],
): number {
	const prefix = `${kbId}/`;
	const dirs = new Set<string>();
	for (const key of Object.keys(fileStatuses)) {
		if (!key.startsWith(prefix)) continue;
		const rel = key.slice(prefix.length);
		const parts = rel.split("/");
		for (let i = 0; i < parts.length - 1; i++) {
			dirs.add(parts.slice(0, i + 1).join("/"));
		}
	}
	for (const node of rootNodes) {
		if (node.type === "directory") dirs.add(node.id);
	}
	return dirs.size;
}

export function knowledgeNodeMatches(node: KnowledgeNode, normalizedQuery: string): boolean {
	if (node.name.toLocaleLowerCase().includes(normalizedQuery)) return true;
	// 仅在已加载子层上匹配，不触发懒加载。
	if (node.children === undefined) return false;
	return node.children.some((child) => knowledgeNodeMatches(child, normalizedQuery));
}

export function formatKnowledgeUpdatedAt(timestamp: number): string {
	if (!timestamp) return "";
	const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
	if (minutes < 60) return i18n.t("settings:kbUpdatedMinutes", { n: minutes });
	const hours = Math.round(minutes / 60);
	if (hours < 24) return i18n.t("settings:kbUpdatedHours", { n: hours });
	return i18n.t("settings:kbUpdatedDays", { n: Math.round(hours / 24) });
}

/** 「待加工文件」平铺项：相对 raws/<kb>/ 的路径 id、文件名、所在相对目录（根为空串）。 */
export interface UnprocessedFile {
	id: string;
	name: string;
	dir: string;
}

/**
 * 递归收集未加工文件（平铺），按 id 排序。
 * 懒加载下仅遍历已加载层；全库待加工请用 collectUnprocessedFromStatuses。
 * @param isUnprocessed 据 node.id 判定是否未加工（仅显式 "unprocessed"）。
 */
export function collectUnprocessedFiles(
	nodes: KnowledgeNode[],
	isUnprocessed: (id: string) => boolean,
): UnprocessedFile[] {
	const out: UnprocessedFile[] = [];
	const walk = (list: KnowledgeNode[]): void => {
		for (const node of list) {
			if (node.type === "directory") {
				if (node.children !== undefined) walk(node.children);
				continue;
			}
			if (isUnprocessed(node.id)) {
				const segments = node.id.split("/");
				out.push({ id: node.id, name: node.name, dir: segments.slice(0, -1).join("/") });
			}
		}
	};
	walk(nodes);
	out.sort((a, b) => a.id.localeCompare(b.id));
	return out;
}

/**
 * 从加工态 map 收集某库全部未加工文件（不依赖文件树是否已懒加载）。
 */
export function collectUnprocessedFromStatuses(
	kbId: string,
	fileStatuses: Record<string, KnowledgeFileStatus>,
): UnprocessedFile[] {
	const prefix = `${kbId}/`;
	const out: UnprocessedFile[] = [];
	for (const [key, status] of Object.entries(fileStatuses)) {
		if (!key.startsWith(prefix) || status.status !== "unprocessed") continue;
		const id = key.slice(prefix.length);
		const segments = id.split("/");
		out.push({ id, name: segments[segments.length - 1] ?? id, dir: segments.slice(0, -1).join("/") });
	}
	out.sort((a, b) => a.id.localeCompare(b.id));
	return out;
}

/**
 * 按面包屑路径段定位到某层子节点。
 * - 返回数组：该层已加载（可为空）
 * - 返回 null：路径上某目录尚未懒加载
 */
export function nodesAtPath(rootNodes: KnowledgeNode[], path: string[]): KnowledgeNode[] | null {
	if (path.length === 0) return rootNodes;
	let current = rootNodes;
	for (const segment of path) {
		const dir = current.find((node) => node.type === "directory" && node.name === segment);
		if (!dir) return [];
		if (dir.children === undefined) return null;
		current = dir.children;
	}
	return current;
}

/** 目录「N 项」：优先 childCount，否则已加载 children 长度。 */
export function knowledgeDirItemCount(node: KnowledgeNode): number {
	if (node.type !== "directory") return 0;
	if (node.childCount !== undefined) return node.childCount;
	return node.children?.length ?? 0;
}
