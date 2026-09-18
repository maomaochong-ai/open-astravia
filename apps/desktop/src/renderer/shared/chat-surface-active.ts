import { createContext, useContext } from "react";

/**
 * 主对话是否在前台。由 DeferredChatSurface 在同一棵子树里提供，
 * keep-alive 的 ChatView 与布局在同一帧看到同一值，不必再经 atom 晚一拍。
 */
export const ChatSurfaceActiveContext = createContext(true);

export function useChatSurfaceActive(): boolean {
	return useContext(ChatSurfaceActiveContext);
}
