/**
 * 工作台的「已加入渲染区的画框」列表运算。
 *
 * 顺序就是导出顺序，左侧缩略图列表是它的补集——两者由同一份数据推导，
 * 不各自维护一份，否则「加入后缩略图要消失」这条规则会立刻分叉。
 */

export function attachFrame(attached: readonly string[], frameId: string, atIndex?: number): string[] {
	if (attached.includes(frameId)) return [...attached];
	const next = [...attached];
	const index = atIndex === undefined ? next.length : Math.min(Math.max(0, Math.floor(atIndex)), next.length);
	next.splice(index, 0, frameId);
	return next;
}

export function detachFrame(attached: readonly string[], frameId: string): string[] {
	return attached.filter((id) => id !== frameId);
}

/** Figma 式：把 A 拖到 B 上就是两者互换，不是插队。 */
export function swapFrames(attached: readonly string[], from: number, to: number): string[] {
	if (from === to) return [...attached];
	if (from < 0 || to < 0 || from >= attached.length || to >= attached.length) return [...attached];
	const next = [...attached];
	[next[from], next[to]] = [next[to], next[from]];
	return next;
}

/** 左侧缩略图列表：还没被加入渲染区的画框，保持传入的画布顺序。 */
export function railFrames<T extends { id: string }>(all: readonly T[], attached: readonly string[]): T[] {
	const taken = new Set(attached);
	return all.filter((frame) => !taken.has(frame.id));
}
