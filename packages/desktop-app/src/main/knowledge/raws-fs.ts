/**
 * 知识库 raws 目录 ↔ UI 的读写桥。
 *
 * raws/<知识库名称>/ 每个顶层目录即一个独立知识库；磁盘是唯一真相源，
 * 用户在 Finder 手改也由此读回。约定平级但允许子目录（UI 走面包屑进入）。
 * 所有写操作走 privilegedWrite，与加工锁互斥：UI 写盘恒成功，新文件下一轮重建。
 */

import type { Dirent } from "node:fs";
import { access, cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import * as knowledge from "@vetta/runtime-knowledge";
import { getKnowledgeRoot } from "./knowledge-layout.js";
import { privilegedWrite } from "./raws-lock.js";

export interface KnowledgeNodeDto {
	/** 相对 raws/<kb>/ 的 posix 路径，稳定、与刷新解耦。 */
	id: string;
	name: string;
	type: "file" | "directory";
	/**
	 * 子节点。懒加载约定：
	 * - `undefined`：尚未拉取该层（目录）
	 * - 数组（可为空）：已拉取
	 * 列表接口每次只返回一层，不递归叶子。
	 */
	children?: KnowledgeNodeDto[];
	/** 子项数量（目录，浅层 readdir 计数，不含隐藏项）；未加载 children 时用于 UI「N 项」。 */
	childCount?: number;
	/** 字节数（文件）。 */
	size?: number;
	/** 本地绝对路径（文件，供全局预览）。 */
	sourcePath?: string;
}

export interface KnowledgeBaseDto {
	/** = 顶层目录名。 */
	id: string;
	name: string;
	/** 目录 mtime（毫秒）。 */
	updatedAt: number;
	/** 默认「个人知识库」：不可删除 / 重命名，磁盘缺失自动重建。 */
	isDefault: boolean;
	nodes: KnowledgeNodeDto[];
}

/**
 * 默认知识库的磁盘目录名：始终存在，用户与磁盘都删不掉（删后自动重建）。
 * 固定为语言无关的 "default_kb"；UI 显示名由 isDefault 标记驱动、走 i18n 映射。
 */
export const DEFAULT_KNOWLEDGE_BASE = "default_kb";

function rawsRoot(): string {
	return knowledge.rawsDir(getKnowledgeRoot());
}

/** 校验单段名（库名 / 文件名）：非空、无路径分隔符、非 . / ..。 */
function assertSafeSegment(name: string): void {
	if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
		throw new Error(`非法名称: ${name}`);
	}
}

/** 解析 raws/<kb>/<relPath> 的绝对路径，并确保不越出该库目录。 */
function resolveInBase(kbId: string, relPath: string): string {
	assertSafeSegment(kbId);
	const baseDir = join(rawsRoot(), kbId);
	const target = join(baseDir, relPath);
	const rel = relative(baseDir, target);
	if (rel.startsWith("..") || rel === "") throw new Error(`非法路径: ${relPath}`);
	return target;
}

// ---------- 读 ----------

/** 解析库内目录绝对路径；relPath 空串 = 库根。 */
function resolveKbDir(kbId: string, relPath: string): string {
	assertSafeSegment(kbId);
	if (!relPath) return join(rawsRoot(), kbId);
	return resolveInBase(kbId, relPath);
}

/**
 * 只读一层目录条目，不递归叶子。
 * 目录节点不带 children（undefined = 未加载），仅带 childCount 供「N 项」展示。
 */
async function listLevel(absDir: string, relBase: string): Promise<KnowledgeNodeDto[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(absDir, { withFileTypes: true });
	} catch {
		return [];
	}
	// 同层文件 stat 与子目录浅计数并行：不递归整树。
	const built = await Promise.all(
		entries
			.filter((entry) => !entry.name.startsWith(".")) // 隐藏文件不入 UI
			.map(async (entry): Promise<KnowledgeNodeDto | null> => {
				const full = join(absDir, entry.name);
				const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
				if (entry.isDirectory()) {
					const childNames = await readdir(full).catch(() => [] as string[]);
					const childCount = childNames.filter((name) => !name.startsWith(".")).length;
					return { id: rel, name: entry.name, type: "directory", childCount };
				}
				if (entry.isFile()) {
					const info = await stat(full).catch(() => null);
					return { id: rel, name: entry.name, type: "file", size: info?.size, sourcePath: full };
				}
				return null;
			}),
	);
	const nodes = built.filter((node): node is KnowledgeNodeDto => node !== null);
	// 目录在前、同类按名排序，贴近 Finder。
	nodes.sort((a, b) => {
		if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name, "zh");
	});
	return nodes;
}

/** 确保默认「个人知识库」目录存在（反向重建：用户/磁盘删了也补回来）。 */
async function ensureDefaultBase(): Promise<void> {
	const dir = join(rawsRoot(), DEFAULT_KNOWLEDGE_BASE);
	if (await exists(dir)) return;
	await privilegedWrite([rawsRoot()], async () => {
		await mkdir(dir, { recursive: true });
	}).catch(() => {});
}

/**
 * 列出全部知识库；每个库只带根层 nodes（一层，不递归叶子）。
 * 进入子目录时由 listKnowledgeDir 按需拉取。
 */
export async function listKnowledgeBases(): Promise<KnowledgeBaseDto[]> {
	const root = rawsRoot();
	await mkdir(root, { recursive: true }).catch(() => {});
	await ensureDefaultBase();
	let entries: Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	// 各知识库根层并行列出，互不阻塞。
	const bases = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
			.map(async (entry): Promise<KnowledgeBaseDto> => {
				const full = join(root, entry.name);
				const info = await stat(full).catch(() => null);
				return {
					id: entry.name,
					name: entry.name,
					updatedAt: info?.mtimeMs ?? 0,
					isDefault: entry.name === DEFAULT_KNOWLEDGE_BASE,
					nodes: await listLevel(full, ""),
				};
			}),
	);
	// 默认库置顶，其余按更新时间倒序。
	bases.sort((a, b) => {
		if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
		return b.updatedAt - a.updatedAt;
	});
	return bases;
}

/**
 * 列出某知识库内一层目录内容（relPath 相对 raws/<kb>/，空串 = 库根）。
 * 不递归；目录子节点需再次调用本接口。
 */
export async function listKnowledgeDir(kbId: string, relPath: string): Promise<KnowledgeNodeDto[]> {
	const abs = resolveKbDir(kbId, relPath);
	return listLevel(abs, relPath);
}

// ---------- 写 ----------

async function exists(p: string): Promise<boolean> {
	return access(p).then(
		() => true,
		() => false,
	);
}

/** 目标目录已存在同名则追加 (1)/(2)… 共存，返回最终绝对路径。 */
async function uniqueDest(dir: string, name: string): Promise<string> {
	const ext = extname(name);
	const stem = ext ? name.slice(0, -ext.length) : name;
	let candidate = name;
	let i = 1;
	while (await exists(join(dir, candidate))) {
		candidate = `${stem} (${i})${ext}`;
		i += 1;
	}
	return join(dir, candidate);
}

async function moveInto(src: string, dest: string): Promise<void> {
	try {
		await rename(src, dest);
	} catch (err) {
		// 跨设备 rename 失败，退化为 copy + 删源。
		if (err instanceof Error && "code" in err && err.code === "EXDEV") {
			await cp(src, dest, { recursive: true });
			await rm(src, { recursive: true, force: true });
		} else {
			throw err;
		}
	}
}

/**
 * 把磁盘上若干文件/目录放进某知识库顶层。
 * @param move 源在应用内（如 agent 产物）置 true 移走；外部文件置 false 复制留源。
 */
export async function addFilesToKnowledgeBase(kbId: string, sourcePaths: string[], move: boolean): Promise<void> {
	assertSafeSegment(kbId);
	const baseDir = join(rawsRoot(), kbId);
	await privilegedWrite([baseDir], async () => {
		await mkdir(baseDir, { recursive: true });
		for (const src of sourcePaths) {
			const dest = await uniqueDest(baseDir, basename(src));
			if (move) await moveInto(src, dest);
			else await cp(src, dest, { recursive: true });
		}
	});
}

/** 删除库内某文件/子目录。 */
export async function deleteKnowledgeEntry(kbId: string, relPath: string): Promise<void> {
	const target = resolveInBase(kbId, relPath);
	const parent = dirname(target);
	await privilegedWrite([parent], async () => {
		await rm(target, { recursive: true, force: true });
	});
}

/** 重命名库内某文件/子目录（同级，newName 为纯文件名）。 */
export async function renameKnowledgeEntry(kbId: string, relPath: string, newName: string): Promise<void> {
	assertSafeSegment(newName);
	const target = resolveInBase(kbId, relPath);
	const parent = dirname(target);
	const dest = join(parent, newName);
	await privilegedWrite([parent], async () => {
		if (await exists(dest)) throw new Error(`已存在同名: ${newName}`);
		await rename(target, dest);
	});
}

/** 新建知识库（顶层目录）。 */
export async function createKnowledgeBase(name: string): Promise<void> {
	assertSafeSegment(name);
	const root = rawsRoot();
	const dir = join(root, name);
	await mkdir(root, { recursive: true }).catch(() => {});
	await privilegedWrite([root], async () => {
		if (await exists(dir)) throw new Error(`知识库已存在: ${name}`);
		await mkdir(dir, { recursive: true });
	});
}

/** 删除整个知识库（顶层目录）。默认库不可删。 */
export async function deleteKnowledgeBase(name: string): Promise<void> {
	assertSafeSegment(name);
	if (name === DEFAULT_KNOWLEDGE_BASE) throw new Error("默认知识库不可删除");
	const root = rawsRoot();
	await privilegedWrite([root], async () => {
		await rm(join(root, name), { recursive: true, force: true });
	});
}

/** 重命名知识库（顶层目录）。默认库不可改名。 */
export async function renameKnowledgeBase(oldName: string, newName: string): Promise<void> {
	assertSafeSegment(oldName);
	assertSafeSegment(newName);
	if (oldName === DEFAULT_KNOWLEDGE_BASE) throw new Error("默认知识库不可重命名");
	const root = rawsRoot();
	const dest = join(root, newName);
	await privilegedWrite([root], async () => {
		if (await exists(dest)) throw new Error(`知识库已存在: ${newName}`);
		await rename(join(root, oldName), dest);
	});
}
