/**
 * LLM Wiki 知识库的领域数据模型。
 *
 * 约定见 docs/prd-knowledge-base-llm-wiki.md。对 agent 而言是单一全局库，
 * 物理布局位于 ~/.vetta/knowledges/。frontmatter 是唯一真相源，tags.json /
 * manifest.json 是可从 frontmatter 重建的缓存。
 */

/** knowledges 目录下的子路径约定。 */
export const KB_DIR_NAME = "knowledges";
export const RAWS_DIR = "raws";
export const WIKI_DIR = "wiki";
export const INDEXES_DIR = "indexes";
/** indexes/ 下自动生成的目录文件（镜像 wiki 树的渐进式披露入口）。 */
export const INDEX_MAP_FILE = "INDEX.md";
export const TAGS_FILE = "tags.json";
export const MANIFEST_FILE = "manifest.json";
/** 加工失败/隔离记录缓存（source_path → 失败次数与隔离标记）。 */
export const FAILURES_FILE = "failures.json";
export const PROCESSING_RECORDS_DIR = "processing_records";

/**
 * wiki 页 frontmatter —— 封闭 schema，有且仅有这 10 个字段。
 * 跨页引用不入 frontmatter，写在正文 markdown 的 [[id]] 里。
 */
export interface WikiFrontmatter {
	/** 稳定、与路径解耦、不可变。创建时分配。 */
	id: string;
	/** 来源分组名（对应 raws/<source>/）。 */
	source: string;
	/** 原始文件相对 raws/ 的路径，如 "手册/api.md"。 */
	source_path: string;
	/** 原始文件内容 hash（sha256），原始文件的主身份。 */
	source_hash: string;
	/** 扁平字符串标签。 */
	tags: string[];
	/** 页标题。 */
	title: string;
	/** 一句话摘要，供 indexes 导读引用。 */
	summary: string;
	/** ISO 时间戳，创建时间，更新时保留。 */
	created_at: string;
	/** ISO 时间戳，最后更新时间。 */
	updated_at: string;
	/** 孤儿标记 ISO 时间戳；正常为 null。 */
	orphaned_at: string | null;
}

/** 封闭 schema 的字段全集与固定写出顺序。 */
export const WIKI_FRONTMATTER_FIELDS = [
	"id",
	"source",
	"source_path",
	"source_hash",
	"tags",
	"title",
	"summary",
	"created_at",
	"updated_at",
	"orphaned_at",
] as const;

/** raws 扫描出的单个原始文件。 */
export interface RawFile {
	/** 来源分组名（raws 下第一段目录）。 */
	source: string;
	/** 相对 raws/ 的路径。 */
	source_path: string;
	/** 内容 hash。 */
	source_hash: string;
	/** 文件字节大小（分批装箱用，扫描算 hash 时顺手取得）。 */
	size: number;
}

/** manifest.json：每页一行的反查缓存。 */
export interface ManifestEntry {
	id: string;
	/** wiki 页相对 wiki/ 的路径。 */
	path: string;
	source_path: string;
	source_hash: string;
	orphaned_at: string | null;
}

export interface Manifest {
	version: 1;
	pages: ManifestEntry[];
}

/** tags.json：tag → 页 id 列表（不含孤儿页）。 */
export interface TagsIndex {
	version: 1;
	tags: Record<string, string[]>;
}

export const EMPTY_MANIFEST: Manifest = { version: 1, pages: [] };
export const EMPTY_TAGS_INDEX: TagsIndex = { version: 1, tags: {} };
