import { conversationTagsAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

/**
 * 把主进程持有的标签快照同步到渲染进程：首屏拉一次，之后跟随广播刷新。
 * 挂载点唯一（侧边栏项目面板），避免多处重复订阅。
 */
export function useConversationTagsSync(): void {
	const setTags = useSetAtom(conversationTagsAtom);

	useEffect(() => {
		let disposed = false;
		void window.vetta.conversationTags
			.list()
			.then((snapshot) => {
				if (!disposed) setTags(snapshot);
			})
			.catch(() => {
				// 读不到就维持空快照：标签入口降级为只剩「新标签」，不阻塞侧边栏。
			});
		const unsubscribe = window.vetta.conversationTags.onChanged((snapshot) => setTags(snapshot));
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [setTags]);
}
