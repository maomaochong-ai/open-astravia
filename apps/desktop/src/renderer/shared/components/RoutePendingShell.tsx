import type { JSX } from "react";

/**
 * 切页 / 懒加载尚未提交内容时的占位：占满主区、不画假卡片骨架。
 * 页头或页面自己的标题才是「点已经生效」的信号；脉冲宫格会看起来像还没进去。
 */
export function RoutePendingShell(): JSX.Element {
	return <div className="flex h-full min-h-0 w-full flex-1 flex-col" aria-busy="true" />;
}
