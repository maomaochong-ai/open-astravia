/**
 * 静态文件协议（ADR-0027）的名字与 URL 拼装，主进程与渲染进程共用。
 *
 * 单独放在 shared 是为了让「只想拼一个 URL」的模块不必 import 主进程的协议实现——
 * 那条链会把 electron 的 `app` 一路拖进来，测试里直接炸。
 */
export const FILE_PROTOCOL_SCHEME = "vetta-file";

/**
 * 把本地绝对路径映射成可直接作 `<img>`/`<iframe>` src 的 URL。
 * 逐段 encodeURIComponent：路径里出现 `#`、`?` 时整段 encodeURI 会把它们当成 URL 语法。
 */
export function createLocalFileUrl(absolutePath: string): string {
	const pathname = absolutePath
		.replaceAll("\\", "/")
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const prefix = pathname.startsWith("/") ? "" : "/";
	return `${FILE_PROTOCOL_SCHEME}://local${prefix}${pathname}`;
}
