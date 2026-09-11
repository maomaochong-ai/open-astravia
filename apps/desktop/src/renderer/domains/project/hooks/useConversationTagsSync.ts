import { conversationFilterTagId, conversationTagsAtom, defaultConversationFilterAtom } from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";

/**
 * 把主进程持有的标签快照同步到渲染进程：首屏拉一次，之后跟随广播刷新。
 * 挂载点唯一（侧边栏项目面板），避免多处重复订阅。
 */
export function useConversationTagsSync(): void {
	const setTags = useSetAtom(conversationTagsAtom);
	const tags = useAtomValue(conversationTagsAtom);
	const [filter, setFilter] = useAtom(defaultConversationFilterAtom);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let disposed = false;
		void window.vetta.conversationTags
			.list()
			.then((snapshot) => {
				if (disposed) return;
				setTags(snapshot);
				setLoaded(true);
			})
			.catch(() => {
				// 读不到就维持空快照：标签入口降级为只剩「新标签」，不阻塞侧边栏。
				if (!disposed) setLoaded(true);
			});
		const unsubscribe = window.vetta.conversationTags.onChanged((snapshot) => setTags(snapshot));
		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [setTags]);

	/**
	 * 选中的标签可能已被删除（本窗口删的，或另一个窗口删的），此时筛选档位指向
	 * 一个不存在的标签，列表会永远空着。等快照到位后校验一次并回落到「对话」——
	 * 加载完成前不校验，否则持久化的标签档会在启动瞬间被误清。
	 */
	useEffect(() => {
		if (!loaded) return;
		const tagId = conversationFilterTagId(filter);
		if (tagId === null) return;
		if (!tags.tags.some((tag) => tag.id === tagId)) setFilter("conversation");
	}, [filter, loaded, setFilter, tags.tags]);
}
