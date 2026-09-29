import type { ScriptsFs } from "./scripts/discover";

/**
 * 底部面板组件是零 props 的，拿不到 activate() 里的 ctx；文件 API 在激活时存到这里。
 * 放在 globalThis 上而不是模块变量：Module Federation 下同一插件的模块可能被求值两次。
 */
const KEY = "__vettaScriptsPluginFs";

type Holder = typeof globalThis & { [KEY]?: ScriptsFs };

export function setScriptsFs(fs: ScriptsFs | undefined): void {
	(globalThis as Holder)[KEY] = fs;
}

export function getScriptsFs(): ScriptsFs | undefined {
	return (globalThis as Holder)[KEY];
}
