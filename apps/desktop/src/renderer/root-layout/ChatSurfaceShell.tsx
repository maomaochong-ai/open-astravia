import { TitledPageShell } from "@shared/components/TitledPageShell";
import { chatSessionTitleAtom } from "../domains/conversation/hooks/chat-session-title";
import { useAtomValue } from "jotai";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";

/** 对话 chunk 未到时的主区身份：会话标题，没有会话则「Vetta 会话」。 */
export function ChatSurfaceShell(): JSX.Element {
	const { t } = useTranslation("chat");
	const title = useAtomValue(chatSessionTitleAtom) ?? t("chatView.defaultSessionTitle");
	return <TitledPageShell title={title} />;
}
