import type { JSX } from "react";

/**
 * 列表还没有缓存时占满内容区。不要铺脉冲宫格：切进知识库时标题已经说明点生效了。
 */
export function KnowledgeFilesSkeleton(): JSX.Element {
	return <div className="flex min-h-0 flex-1" aria-busy="true" />;
}
