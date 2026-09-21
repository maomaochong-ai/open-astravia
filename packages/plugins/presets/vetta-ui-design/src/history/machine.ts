/**
 * 一条路径属于哪台机器，以及交给那台机器上的进程时该长什么样。
 *
 * 设计稿可能在远程项目里（路径形如 `ssh://<hostId>/<远端绝对路径>`）。历史仓库住在设计包
 * 内部（`<design>/.history`），所以它必须建在设计稿所在的那台机器上——把 `ssh://…` 交给
 * 本机的 node，只会在本机进程的工作目录下拼出一棵 `ssh:` 目录，而真正的设计稿一无所获。
 *
 * 宿主按命令的 cwd 决定在哪台机器上执行，所以这里只需两件事：把设计稿的路径当 cwd 传下去，
 * 以及把要交给那台机器上 node 的路径去掉归属前缀。
 */
const SSH_SCHEME = "ssh://";

/** 缓存键：同一台机器上的物化产物与家目录才能复用。 */
export function machineOf(path: string): string {
	if (!path.startsWith(SSH_SCHEME)) return "local";
	const separator = path.indexOf("/", SSH_SCHEME.length);
	return separator < 0 ? path : path.slice(0, separator);
}

/** 交给那台机器上的进程的路径。本机路径原样返回。 */
export function machineLocalPath(path: string): string {
	if (!path.startsWith(SSH_SCHEME)) return path;
	const separator = path.indexOf("/", SSH_SCHEME.length);
	return separator < 0 ? "/" : path.slice(separator);
}
