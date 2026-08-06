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
	timeLabel: string;
	active: boolean;
	renaming: boolean;
	running: boolean;
	scheduled: boolean;
	session: unknown;
}

export function reuseUnchangedSessionViews<T extends SessionRowViewLike>(cache: Map<string, T>, next: T[]): T[] {
	const result = next.map((view) => {
		const cached = cache.get(view.path);
		if (
			cached &&
			cached.key === view.key &&
			cached.label === view.label &&
			cached.timeLabel === view.timeLabel &&
			cached.active === view.active &&
			cached.renaming === view.renaming &&
			cached.running === view.running &&
			cached.scheduled === view.scheduled &&
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
