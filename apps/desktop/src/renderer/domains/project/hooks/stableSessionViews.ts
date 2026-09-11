/**
 * 会话行视图对象的引用复用。
 *
 * 切换会话时只有「上一条」「下一条」两行的 active 变了，但构造列表的 useMemo 依赖
 * activeSessionPath，重跑时会把每一行都造成新对象——下游行组件的 memo 因此全部落空，
 * 整份列表跟着重渲染。这里按 path 缓存上一轮的对象，字段完全相同就把旧引用还回去。
 */

interface SessionRowViewLike {
	key: string;
	path: string;
	label: string;
	iconClassName?: string;
	trailingAvatarUrls?: readonly string[];
	tagColors?: readonly string[];
	active: boolean;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	pinned: boolean;
	session: unknown;
}

/** 标签色点每轮都是新数组，按值比，否则打过标的行永远复用不到旧引用。 */
function sameTagColors(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((color, index) => color === b[index]);
}

export function reuseUnchangedSessionViews<T extends SessionRowViewLike>(cache: Map<string, T>, next: T[]): T[] {
	const result = next.map((view) => {
		const cached = cache.get(view.path);
		if (
			cached &&
			cached.key === view.key &&
			cached.label === view.label &&
			cached.iconClassName === view.iconClassName &&
			cached.trailingAvatarUrls === view.trailingAvatarUrls &&
			sameTagColors(cached.tagColors, view.tagColors) &&
			cached.active === view.active &&
			cached.renaming === view.renaming &&
			cached.running === view.running &&
			cached.scheduled === view.scheduled &&
			cached.pinned === view.pinned &&
			cached.session === view.session
		) {
			return cached;
		}
		return view;
	});
	cache.clear();
	for (const view of result) cache.set(view.path, view);
	return result;
}
