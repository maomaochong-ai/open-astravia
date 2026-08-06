/**
 * 图片路径列表的引用稳定化。
 *
 * 与 atom 分开放：atom 那侧 import 了 @shared/store/atoms，而它在模块加载期就会读
 * localStorage（auth-atoms），在 node 测试环境下直接抛错。纯函数留在这里可独立测试。
 *
 * 单例缓存足够：同一时刻只有一个 InputBar 挂载（会话页与新会话页是不同路由）。
 */
let last: readonly string[] = [];

/** 内容与上一次等价时返回上一份引用，让订阅方不必逐字符重渲染。 */
export function stableImagePaths(next: readonly string[]): readonly string[] {
	if (next.length === last.length && next.every((path, index) => last[index] === path)) {
		return last;
	}
	last = next;
	return next;
}

export function initialImagePaths(): readonly string[] {
	return last;
}
