import { sameProjectLocation } from "@vetta/ssh-transport";

/**
 * 项目身份比较。
 *
 * 本地沿用 Desktop 既有约定：大小写不敏感、分隔符无关。远程项目按 `(主机, 路径)`
 * 比较且路径大小写敏感——Linux 上 `App` 与 `app` 是两个目录，按本地规则归一化会让
 * 它们合并成同一个项目。本地路径与同名远端路径永不相等，否则远程项目的操作会落到
 * 本机那个碰巧同名的仓库上（ADR-0124 的执行边界）。
 */
export function sameProjectPath(first: string, second: string): boolean {
	return sameProjectLocation(first, second);
}
