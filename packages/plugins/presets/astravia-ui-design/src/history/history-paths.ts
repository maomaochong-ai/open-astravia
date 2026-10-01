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

export function historyDirOf(designDir: string): string {
	return `${designDir}/${HISTORY_DIR}`;
}
