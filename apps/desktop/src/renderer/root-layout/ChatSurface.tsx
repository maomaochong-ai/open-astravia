import { lazy, Suspense, type JSX } from "react";
import { loadChatPage } from "../domains/conversation/components/loadChatPage";
import { ChatSurfaceShell } from "./ChatSurfaceShell";

const ChatPage = lazy(loadChatPage);

export function ChatSurface(): JSX.Element {
	return (
		<Suspense fallback={<ChatSurfaceShell />}>
			<ChatPage />
		</Suspense>
	);
}
