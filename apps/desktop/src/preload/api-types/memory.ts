export type MemoryScope = "user" | "project";

export interface MemoryFileSnapshot {
	/** 该作用域实际读取的 MEMORY.md 绝对路径，界面需要展示它以免用户误改别的文件。 */
	path: string;
	content: string;
	exists: boolean;
}

export interface MemoryFilesSnapshot {
	user: MemoryFileSnapshot;
	/** 没有会话工作目录时为 null，界面据此展示「暂无项目」而不是展示一个拼不出来的路径。 */
	project: MemoryFileSnapshot | null;
}

export interface MemoryReadParams {
	/**
	 * 项目级记忆所属的会话工作目录；用户级记忆与它无关。
	 * 空串表示当前还没有项目目录，此时项目级记忆为 null。
	 */
	cwd: string;
}

export interface MemoryWriteParams {
	scope: MemoryScope;
	/** 仅写入项目级记忆时必填。 */
	cwd: string;
	content: string;
}

export interface DesktopMemoryApi {
	read(params: MemoryReadParams): Promise<MemoryFilesSnapshot>;
	write(params: MemoryWriteParams): Promise<void>;
}
