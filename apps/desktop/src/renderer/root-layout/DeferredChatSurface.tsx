import { ChatSurfaceActiveContext } from "@shared/chat-surface-active";
import type { JSX, ReactNode } from "react";
import { DeferredSurface } from "@shared/components/DeferredSurface";

export interface DeferredChatSurfaceProps {
	active: boolean;
	children: ReactNode;
	/** 切回已挂载保活页时关掉，避免离场帧盖住目标页标题。 */
	stackLeave?: boolean;
}

/** 主对话 surface：复用通用 DeferredSurface，并提供聊天专用的前台 Context。 */
export function DeferredChatSurface({
	active,
	children,
	stackLeave = true,
}: DeferredChatSurfaceProps): JSX.Element {
	return (
		<ChatSurfaceActiveContext.Provider value={active}>
			<DeferredSurface active={active} name="chat" stackLeave={stackLeave}>
				{children}
			</DeferredSurface>
		</ChatSurfaceActiveContext.Provider>
	);
}
