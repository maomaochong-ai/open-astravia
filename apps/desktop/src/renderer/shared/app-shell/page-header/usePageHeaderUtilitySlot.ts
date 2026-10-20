import { pageHeaderUtilityEntriesAtom } from "@shared/store/ui-atoms";
import { useSetAtom } from "jotai";
import { type ReactNode, useEffect } from "react";

/**
 * 往顶栏工具位登记一个节点，`owner` 唯一标识调用方。
 *
 * 直接覆盖同一个原子会让同屏的两个入口（对话页顶栏、活动面板的文件标签）互相
 * 清空对方：后注册的顶掉前一个，先卸载的又把它置空。这里按 owner 分槽，
 * 卸载时只回收自己那份，渲染哪一个由优先级决定。
 */
export function usePageHeaderUtilitySlot(owner: string, priority: number, node: ReactNode | null): void {
	const setEntries = useSetAtom(pageHeaderUtilityEntriesAtom);
	useEffect(() => {
		if (!node) return;
		setEntries((prev) => new Map(prev).set(owner, { node, priority }));
		return () =>
			setEntries((prev) => {
				if (!prev.has(owner)) return prev;
				const next = new Map(prev);
				next.delete(owner);
				return next;
			});
	}, [node, owner, priority, setEntries]);
}
