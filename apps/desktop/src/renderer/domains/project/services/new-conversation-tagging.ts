import { conversationFilterTagId, defaultConversationFilterAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";

/**
 * 筛选档停在某个标签时，新建的会话继承这个标签。
 *
 * 依据是用户此刻看到的列表：既然侧栏只剩「标签 A」，在这里开的新会话理应留在同一
 * 视图里，否则它一创建就从列表中消失，看着像新建失败。标签档之外（对话 / Claw）
 * 不做任何标注。
 */
export async function applyActiveTagFilterToNewConversation(sessionPath: string): Promise<void> {
	if (!sessionPath) return;
	const tagId = conversationFilterTagId(getDefaultStore().get(defaultConversationFilterAtom));
	if (tagId === null) return;
	await window.vetta.conversationTags.assign({ sessionPath, tagId, assigned: true });
}
