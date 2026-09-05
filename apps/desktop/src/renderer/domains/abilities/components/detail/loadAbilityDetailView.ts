/**
 * 详情正文的共享加载器。抽屉壳不依赖 Markdown/Shiki 等重量级模块，
 * 调用方可在空闲期或用户悬停时预取正文，打开时先显示抽屉和基础信息。
 */
export function loadAbilityDetailView() {
	return import("./AbilityDetailView").then(({ AbilityDetailView }) => ({ default: AbilityDetailView }));
}
