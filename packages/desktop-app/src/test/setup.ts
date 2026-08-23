/**
 * vitest 全局环境兜底：`chat-atoms` 等模块在顶层就访问 `localStorage`，
 * 而 node 环境没有这个全局（Node 22 的 `--localstorage-file` 默认不启用）。
 * 这里在缺失时注入一个内存实现，保证 import 链在 node 环境下也能加载。
 */
function createMemoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length(): number {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key: string) => map.get(key) ?? null,
		key: (index: number) => [...map.keys()][index] ?? null,
		removeItem: (key: string) => void map.delete(key),
		setItem: (key: string, value: string) => void map.set(key, String(value)),
	};
}

if (typeof globalThis.localStorage === "undefined") {
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createMemoryStorage() });
}
