/**
 * Set up HTTP proxy according to env variables for `fetch` based SDKs in Node.js.
 * Bun has builtin support for this.
 *
 * This module should be imported early by any code that needs proxy support for fetch().
 * ES modules are cached, so importing multiple times is safe - setup only runs once.
 */
if (typeof process !== "undefined" && process.versions?.node) {
	import("undici")
		.then((m) => {
			const { EnvHttpProxyAgent, setGlobalDispatcher } = m;
			setGlobalDispatcher(new EnvHttpProxyAgent());
		})
		// 加载失败必须自己收口：这里的 rejection 曾经逃逸成
		// UnhandledPromiseRejectionWarning，污染 RPC 宿主的 stderr，而代理失效本身
		// 毫无提示（打包器把 undici 里惰性的 `require("node:sqlite")` 提升成顶层静态
		// import，Electron 没有该内置模块，整个 undici chunk 加载失败）。
		.catch((error: unknown) => {
			const reason = error instanceof Error ? error.message : String(error);
			console.warn(`[ai] HTTP proxy support disabled: failed to load undici (${reason})`);
		});
}
