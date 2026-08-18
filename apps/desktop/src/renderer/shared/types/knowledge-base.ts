export interface KnowledgeNode {
	/** 相对 raws/<kb>/ 的 posix 路径，稳定。 */
	id: string;
	name: string;
	type: "directory" | "file";
	/**
	 * 子节点。懒加载：`undefined` = 未拉取该层；数组 = 已拉取。
	 * list / listDir 每次只返回一层，不预取叶子。
	 */
	children?: KnowledgeNode[];
	/** 目录浅层子项数（未加载 children 时用于「N 项」）。 */
	childCount?: number;
	size?: number;
	/** 本地绝对路径（文件，供全局预览）。 */
	sourcePath?: string;
}

export interface KnowledgeBase {
	/** = 顶层目录名。 */
	id: string;
	name: string;
	updatedAt: number;
	/** 默认「个人知识库」：不可删除 / 重命名。 */
	isDefault: boolean;
	nodes: KnowledgeNode[];
}

/** 文件加工态：已加工 / 待更新（源已改待重加工）/ 加工失败（已隔离）/ 未加工。 */
export type KnowledgeProcessStatus = "processed" | "stale" | "failed" | "unprocessed";

export interface KnowledgeFileStatus {
	status: KnowledgeProcessStatus;
	/** 加工产物 wiki md 的本地绝对路径（processed / stale 有，供「查看 wiki」预览）。 */
	wikiPath?: string;
}

/** 待导入草稿：选中/拖入的磁盘路径，确认后平铺复制进目标库。 */
export interface KnowledgeImportDraft {
	/** 待导入的磁盘绝对路径。createOnly 时为空。 */
	sourcePaths: string[];
	/** 触发时的活动库 id（drop/pick 预选目标）。 */
	defaultTargetId: string | null;
	/** 仅创建知识库、不带文件的入口。 */
	createOnly?: boolean;
}
