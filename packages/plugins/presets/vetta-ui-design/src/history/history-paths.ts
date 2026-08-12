/**
 * 设计历史在磁盘上的位置与忽略清单（ADR-0069）。唯一事实源：runner、`.gitignore`
 * 写入、缩略图存取问的是同一件事，各写一份迟早对不上。
 */

/**
 * 历史仓库的 gitdir，在设计包内部。
 *
 * 刻意不叫 `.git`：设计经常被放进用户自己的代码仓库，叫 `.git` 会让它变成
 * embedded repository——`git add` 报警告、clone 下来是个空壳。
 */
export const HISTORY_DIR = ".history";

/** 版本缩略图。不进 git 对象库：它是可丢弃的展示资源，不值得进历史。 */
export const HISTORY_THUMBS_DIR = `${HISTORY_DIR}/thumbs`;

export function historyDirOf(designDir: string): string {
	return `${designDir}/${HISTORY_DIR}`;
}

export function thumbsDirOf(designDir: string, sha: string): string {
	return `${designDir}/${HISTORY_THUMBS_DIR}/${sha}`;
}
