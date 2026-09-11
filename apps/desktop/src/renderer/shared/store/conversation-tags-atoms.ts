import { atom } from "jotai";
import { type ConversationTagsSnapshot, emptyConversationTags } from "../../../shared/conversation-tags";

/**
 * 标签快照由主进程持有，渲染进程只做缓存：首屏 IPC 拉一次，之后跟随广播刷新。
 * 未加载完时保持空快照——菜单与筛选下拉据此只显示不依赖标签的部分。
 */
export const conversationTagsAtom = atom<ConversationTagsSnapshot>(emptyConversationTags());

/** 标签弹窗：create 来自右键菜单的「新标签」（带上下文会话），manage 来自「管理标签…」。 */
export type ConversationTagEditorState =
	| { readonly mode: "create"; readonly sessionPath?: string }
	| { readonly mode: "manage" };

export const conversationTagEditorAtom = atom<ConversationTagEditorState | null>(null);
