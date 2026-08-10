import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { getPluginCtx, notify } from "../plugin-context";

/**
 * 「让 Vetta 处理」的会话闸口与发送动作。抽屉与气泡 thread 弹层共用，保证两个
 * 入口的可用性判断和提示词完全一致。
 *
 * 备注内容不进 prompt：agent 收到指令后自己调 vetd_notes 拉全量（含现截的编号
 * 标注图），prompt 只负责把它指过去。
 */
export interface NotesHandoff {
	/** null = 可以发送；否则是禁用原因（已本地化，直接展示）。 */
	blockedReason: string | null;
	sendAll(count: number): void;
	sendOne(noteId: string): void;
}

export function useNotesHandoff(cwd: string | null): NotesHandoff {
	const { t } = useTranslation();
	const [conversation, setConversation] = useState<{ cwd: string | null; isStreaming: boolean } | null>(null);

	useEffect(() => {
		const handle = getPluginCtx().conversation.on((event) => {
			if (event.type === "conversation-changed") {
				setConversation({ cwd: event.conversation.cwd, isStreaming: event.conversation.isStreaming });
			} else if (event.type === "turn-start") {
				setConversation((current) => (current ? { ...current, isStreaming: true } : current));
			} else if (event.type === "turn-end") {
				setConversation((current) => (current ? { ...current, isStreaming: false } : current));
			}
		});
		return () => handle.dispose();
	}, []);

	const blockedReason = !conversation?.cwd
		? t("notes.handoff.noConversation")
		: cwd !== null && conversation.cwd !== cwd
			? t("notes.handoff.otherWorkspace")
			: conversation.isStreaming
				? t("notes.handoff.streaming")
				: null;

	const send = (prompt: string): void => {
		// sendPrompt 要整轮跑完才 resolve，不 await；发送失败单独报（与设计体系 Dialog 同型）。
		void getPluginCtx()
			.conversation.sendPrompt(prompt)
			.catch((error: unknown) => notify({ message: t("notes.handoff.failed"), error }));
	};

	return {
		blockedReason,
		sendAll: (count) => send(t("notes.prompt.all", { count })),
		sendOne: (noteId) => send(t("notes.prompt.one", { id: noteId })),
	};
}
