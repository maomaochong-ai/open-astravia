/**
 * `node:sqlite` 替身。
 *
 * Electron 的 Node 没有 `node:sqlite`。undici 只在 runtime-features 里用
 * **惰性 require + try/catch** 探测它（`ERR_UNKNOWN_BUILTIN_MODULE` 会被吞掉），
 * 但 Rollup 把那个 require 提升成了 chunk 顶层的静态 ESM import：
 *
 *     import require$$1 from "node:sqlite";   // ← 整个 chunk 直接加载失败
 *
 * 于是 `import("undici")` 永远 reject。因为 `@vetta/ai` 的 http-proxy 用它安装
 * `EnvHttpProxyAgent`，打包版里 `HTTP_PROXY` / `HTTPS_PROXY` 静默失效，同时在
 * agent-rpc 子进程 stderr 上刷出 UnhandledPromiseRejectionWarning。
 *
 * 把 `node:sqlite` 换成这个模块后 chunk 能正常加载。undici 代码路径里没有任何
 * 地方消费 `runtimeFeatures.has("sqlite")`（只有 crypto / zstd / markAsUncloneable
 * 会），只有显式构造 `SqliteCacheStore` 才会真的用到 —— 我们不用它。万一有人用了，
 * 下面的构造函数会给出明确报错，而不是静默走错分支。
 */

const UNAVAILABLE = "node:sqlite is not available in Electron's Node runtime (see src/main/shims/node-sqlite.ts)";

export class DatabaseSync {
	constructor() {
		throw new Error(UNAVAILABLE);
	}
}

export class StatementSync {
	constructor() {
		throw new Error(UNAVAILABLE);
	}
}

export const constants: Record<string, number> = {};

export function backup(): never {
	throw new Error(UNAVAILABLE);
}

export default { DatabaseSync, StatementSync, constants, backup };
