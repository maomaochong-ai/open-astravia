/**
 * 会话 cwd 可能是远程项目的标识 `ssh://<hostId>/<远端路径>`。宿主按 cwd 的归属决定命令在
 * 哪台机器上执行，所以由 cwd 派生出来的每一条路径都必须带着同一个归属。
 *
 * git 自己输出的路径（`rev-parse --show-toplevel`）是那台机器上的裸绝对路径。原样拿去当
 * 下一条命令的 cwd，宿主会把它当成**本机**路径：后续的 status、commit 要么失败，要么落到
 * 本机一个恰好同路径的仓库上。
 */
const REMOTE_ORIGIN = /^ssh:\/\/[^/]+/;

export function rebaseOntoWorkspace(workspaceCwd: string, absolutePath: string): string {
	const origin = REMOTE_ORIGIN.exec(workspaceCwd)?.[0];
	if (!origin || !absolutePath.startsWith("/")) return absolutePath;
	return `${origin}${absolutePath}`;
}
