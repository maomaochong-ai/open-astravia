/** 知识库 raws ↔ UI 的读写契约。磁盘（~/.vetta/knowledges/raws/）是唯一真相源。 */

export interface KnowledgeNodeDto {
	/** 相对 raws/<kb>/ 的 posix 路径，稳定。 */
	id: string;
	name: string;
	type: "file" | "directory";
	/**
	 * 子节点。懒加载：`undefined` = 未拉取该层；数组 = 已拉取。
	 * list / listDir 每次只返回一层。
	 */
	children?: KnowledgeNodeDto[];
	/** 目录浅层子项数（未加载 children 时用于「N 项」）。 */
	childCount?: number;
	size?: number;
	/** 本地绝对路径（文件）。 */
	sourcePath?: string;
}

export interface KnowledgeBaseDto {
	/** = 顶层目录名。 */
	id: string;
	name: string;
	updatedAt: number;
	/** 默认「个人知识库」：不可删除 / 重命名。 */
	isDefault: boolean;
	nodes: KnowledgeNodeDto[];
}

/** 文件加工态：已加工 / 待更新（源已改待重加工）/ 加工失败（已隔离）/ 未加工。 */
export type KnowledgeProcessStatus = "processed" | "stale" | "failed" | "unprocessed";

export interface KnowledgeFileStatus {
	status: KnowledgeProcessStatus;
	/** 加工产物 wiki md 的本地绝对路径（processed / stale 有，供「查看 wiki」预览）。 */
	wikiPath?: string;
}

export interface DesktopKnowledgeApi {
	/** 立即跑一轮加工（手动触发，不等轮询周期）。skipped 时 reason 指明原因（无变更/未配置模型）。 */
	scanNow(): Promise<{ skipped: boolean; reason?: "no-model" }>;
	/** 解除全部加工失败（隔离）文件的隔离并立即重试加工一轮。 */
	retryFailed(): Promise<{ skipped: boolean; reason?: "no-model" }>;
	/** 据当前设置重新调度后台轮询器（保存知识库设置后调用）。 */
	reload(): Promise<void>;
	/** 从磁盘 raws/ 读出全部知识库；每个库仅根层 nodes（一层，不递归）。 */
	list(): Promise<KnowledgeBaseDto[]>;
	/**
	 * 列出某库内一层目录（relPath 相对 raws/<kb>/，空串 = 库根）。
	 * 不递归；进入子目录需再调。
	 */
	listDir(kbId: string, relPath: string): Promise<KnowledgeNodeDto[]>;
	/** 推导全部 raws 文件的加工态，按 source_path（`${kbId}/${relPath}`）索引。 */
	fileStatuses(): Promise<Record<string, KnowledgeFileStatus>>;
	/** 把磁盘上的文件/目录放进某库顶层。move=true 移走源，false 复制留源。同名自动改名共存。 */
	addFiles(kbId: string, sourcePaths: string[], move: boolean): Promise<void>;
	/** 删除库内某文件/子目录。 */
	deleteEntry(kbId: string, relPath: string): Promise<void>;
	/** 重命名库内某文件/子目录（newName 为纯文件名）。 */
	renameEntry(kbId: string, relPath: string, newName: string): Promise<void>;
	/** 新建知识库（顶层目录）。 */
	create(name: string): Promise<void>;
	/** 删除整个知识库。 */
	delete(name: string): Promise<void>;
	/** 重命名知识库。 */
	rename(oldName: string, newName: string): Promise<void>;
	/** 清空全部已整理的 wiki 产物（影响所有知识库）并重建空索引；原始资料保留，下一轮会重新整理。 */
	clearWiki(): Promise<void>;
	/** 只清空加工历史记录（每轮加工的会话）；已整理的 wiki 产物不受影响。 */
	clearRecords(): Promise<void>;
	/** 删除指定原始文件（relPaths，相对 raws/<kbId>/）已整理出的 wiki 页并重建索引；删后下一轮重整理。 */
	deleteWiki(kbId: string, relPaths: string[]): Promise<void>;
	/** 当前是否正在加工（建立索引）。 */
	isProcessing(): Promise<boolean>;
	/** 订阅加工状态变化（顶栏「正在建立索引…」徽标）。返回取消订阅函数。 */
	onProcessingChanged(handler: (processing: boolean) => void): () => void;
	/** 订阅文件加工态变化（每批加工完重建索引后触发）。渲染层据此重取文件列表状态。返回取消订阅函数。 */
	onStatusesChanged(handler: () => void): () => void;
}
