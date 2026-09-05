/**
 * 详情抽屉的共享加载器。
 *
 * 能力页首屏不应同步求值 Markdown/Shiki；调用方可以在用户明确表现出
 * 查看详情的意图（悬停/按下）或页面空闲时预取，React.lazy 复用同一个
 * 模块缓存。
 */
export function loadAbilityDetailSheet() {
	return import("./AbilityDetailSheet").then(({ AbilityDetailSheet }) => ({ default: AbilityDetailSheet }));
}
