/**
 * Node 22 自带一个未启用的 `globalThis.localStorage`（需要 --localstorage-file 才可用），
 * vitest 的 jsdom 环境不会覆盖这个已存在的全局，于是 renderer 模块在 DOM 测试里读到 undefined。
 * 这里在 DOM 环境下补一个内存实现；node 环境的测试不受影响。
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

if (typeof window !== "undefined" && typeof globalThis.localStorage === "undefined") {
	const storage = window.localStorage ?? createMemoryStorage();
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
	if (globalThis.window !== undefined && window.localStorage === undefined) {
		Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
	}
}
