import { isKnowledgeDirLoaded, mergeKnowledgeDirChildren } from "@domains/knowledge-base/lib/knowledge-base";
import type { KnowledgeBase, KnowledgeFileStatus, KnowledgeImportDraft } from "@shared/types/knowledge-base";
import { atom } from "jotai";

export type {
	KnowledgeBase,
	KnowledgeFileStatus,
	KnowledgeImportDraft,
	KnowledgeNode,
	KnowledgeProcessStatus,
} from "@shared/types/knowledge-base";

const ACTIVE_KNOWLEDGE_BASE_STORAGE_KEY = "vetta-active-knowledge-base";
const KNOWLEDGE_VIEW_MODE_STORAGE_KEY = "vetta-knowledge-view-mode";

/** 文件区视图：宫格 / 列表。 */
export type KnowledgeViewMode = "grid" | "list";

/**
 * 知识库列表：磁盘 ~/.vetta/knowledges/raws/ 是唯一真相源。
 * list 仅根层；子目录由 ensureKnowledgeDirLoadedAtom 按层合并进 nodes。
 */
export const knowledgeBasesAtom = atom<KnowledgeBase[]>([]);

/**
 * 文件加工态：按 source_path（`${kbId}/${node.id}`）索引，由 manifest + raws hash 推导。
 * 与知识库列表同源刷新。
 */
export const knowledgeFileStatusesAtom = atom<Record<string, KnowledgeFileStatus>>({});

/**
 * 列表首次加载中：仅当尚无任何缓存（首次进页）时用于骨架屏。
 * 刷新已有数据时保持旧快照、不显示骨架，避免闪烁。
 */
export const knowledgeLoadingAtom = atom(false);

/**
 * 加工态是否已完成至少一次拉取。
 * 未 hydrated 前不得把缺 key 当成 unprocessed 渲染，否则文件多时会先灰 0.几秒再出角标。
 * 刷新时保留旧 statuses（stale-while-revalidate），不把 hydrated 置回 false。
 */
export const knowledgeStatusesHydratedAtom = atom(false);

/** 进行中的 listDir，按 `${kbId}\0${relPath}` 去重。 */
const knowledgeDirInflight = new Map<string, Promise<void>>();

/**
 * 按需加载某库 relPath 一层（空串 = 库根）并合并进 knowledgeBasesAtom。
 * 已加载则 no-op；并发同 path 共用一个 Promise。
 */
export const ensureKnowledgeDirLoadedAtom = atom(null, async (get, set, payload: { kbId: string; relPath: string }) => {
	const { kbId, relPath } = payload;
	const base = get(knowledgeBasesAtom).find((b) => b.id === kbId);
	if (!base) return;
	if (isKnowledgeDirLoaded(base.nodes, relPath)) return;

	const key = `${kbId}\0${relPath}`;
	const existing = knowledgeDirInflight.get(key);
	if (existing) {
		await existing;
		return;
	}

	const task = (async () => {
		try {
			const children = await window.vetta.knowledge.listDir(kbId, relPath);
			const latest = get(knowledgeBasesAtom);
			set(
				knowledgeBasesAtom,
				latest.map((b) =>
					b.id === kbId ? { ...b, nodes: mergeKnowledgeDirChildren(b.nodes, relPath, children) } : b,
				),
			);
		} finally {
			knowledgeDirInflight.delete(key);
		}
	})();
	knowledgeDirInflight.set(key, task);
	await task;
});

/**
 * 确保面包屑路径链上每一层目录都已加载（含目标层），便于深链跳转。
 * pathSegments 为相对库根的目录名序列；空数组 no-op（库根由 list 提供）。
 */
export const ensureKnowledgePathLoadedAtom = atom(
	null,
	async (_get, set, payload: { kbId: string; pathSegments: string[] }) => {
		const { kbId, pathSegments } = payload;
		// 逐层：['a','b'] → 先 'a' 再 'a/b'
		for (let i = 0; i < pathSegments.length; i++) {
			const relPath = pathSegments.slice(0, i + 1).join("/");
			await set(ensureKnowledgeDirLoadedAtom, { kbId, relPath });
		}
	},
);

/**
 * 反向重建入口：从磁盘重读知识库根层与加工态。
 * list 只拉每库一层；子目录缓存由 merge 尽量保留，但 list 替换根层后子树依赖 mergePreserve。
 * list 与 statuses 并行；首屏有文件时等 statuses hydrated 再出 item。
 */
export const refreshKnowledgeBasesAtom = atom(null, async (get, set) => {
	set(knowledgeLoadingAtom, true);
	const previous = get(knowledgeBasesAtom);
	const listPromise = window.vetta.knowledge.list().then((bases) => {
		// 根层新数据 + 尽量保留已懒加载的子目录缓存
		const prevById = new Map(previous.map((b) => [b.id, b]));
		set(
			knowledgeBasesAtom,
			bases.map((base) => {
				const old = prevById.get(base.id);
				if (!old) return base;
				return { ...base, nodes: mergeKnowledgeDirChildren(old.nodes, "", base.nodes) };
			}),
		);
	});
	const statusesPromise = window.vetta.knowledge
		.fileStatuses()
		.then((statuses) => {
			set(knowledgeFileStatusesAtom, statuses);
		})
		.catch(() => {
			// 失败也视为已尝试，避免永久骨架；缺 key 的文件不再被当成 unprocessed。
		})
		.finally(() => {
			set(knowledgeStatusesHydratedAtom, true);
		});
	try {
		await listPromise;
	} finally {
		set(knowledgeLoadingAtom, false);
	}
	await statusesPromise;
});

const activeKnowledgeBaseIdBaseAtom = atom<string | null>(localStorage.getItem(ACTIVE_KNOWLEDGE_BASE_STORAGE_KEY));

/** 当前选中知识库 id（纯 UI 偏好，存 localStorage）。 */
export const activeKnowledgeBaseIdAtom = atom(
	(get) => {
		const bases = get(knowledgeBasesAtom);
		const remembered = get(activeKnowledgeBaseIdBaseAtom);
		if (remembered && bases.some((base) => base.id === remembered)) return remembered;
		return bases[0]?.id ?? null;
	},
	(_get, set, id: string | null) => {
		set(activeKnowledgeBaseIdBaseAtom, id);
		if (id) localStorage.setItem(ACTIVE_KNOWLEDGE_BASE_STORAGE_KEY, id);
		else localStorage.removeItem(ACTIVE_KNOWLEDGE_BASE_STORAGE_KEY);
	},
);

/** 待导入草稿（拖入/选择文件或仅创建库）。 */
export const knowledgeImportDraftAtom = atom<KnowledgeImportDraft | null>(null);

/**
 * 一次性跳转目标：「待加工文件」弹窗点击某项时写入，KnowledgeContentsPanel 消费后清空。
 * fileId 为相对 raws/<kb>/ 的 posix 路径（= KnowledgeNode.id），用于定位所在目录并高亮滚动。
 */
export const knowledgeNavTargetAtom = atom<{ fileId: string } | null>(null);

/**
 * 各知识库当前浏览路径（相对库根的目录名序列）。
 * 放 atom 而非组件 state：页面骨架/库切换时面板可能重挂载，本地 path 会丢并弹回根层。
 */
export const knowledgeBrowsePathByBaseAtom = atom<Record<string, string[]>>({});

const knowledgeViewModeBaseAtom = atom<KnowledgeViewMode>(
	localStorage.getItem(KNOWLEDGE_VIEW_MODE_STORAGE_KEY) === "list" ? "list" : "grid",
);

/** 文件区视图偏好（纯 UI 偏好，存 localStorage）。 */
export const knowledgeViewModeAtom = atom(
	(get) => get(knowledgeViewModeBaseAtom),
	(_get, set, mode: KnowledgeViewMode) => {
		set(knowledgeViewModeBaseAtom, mode);
		localStorage.setItem(KNOWLEDGE_VIEW_MODE_STORAGE_KEY, mode);
	},
);
