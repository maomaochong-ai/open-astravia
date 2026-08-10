import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef, useState } from "react";
import { getPluginCtx, notify } from "../plugin-context";
import type { NotesStore } from "./notes-store";
import { pendingNotes } from "./types";

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

/**
 * 落下备注后等这么久再派活。用户往往连着放好几条，一放下就叫 agent 的话，第一条
 * 会立刻把会话占住，第二条起全都堵在「它正忙」里。期间又放了就重新计时。
 */
const AUTO_DISPATCH_DEBOUNCE_MS = 1_500;

/**
 * 备注自动派活：只要会话空闲，新落下的（以及重开的）备注就自己交给 agent，不必等
 * 用户去点「让 Vetta 处理」。
 *
 * 会话忙时什么都不做——备注的被动特性此刻正是它的价值（不打断当前这一轮）；等这轮
 * 结束、闸口放行，攒下的会一并派出去。
 *
 * 派过的记在 store 上（`markDispatched`），所以 agent 处理了却忘记 resolve 的备注
 * 不会被一轮轮重新派出去空转。
 */
export function useNotesAutoDispatch(notes: NotesStore, cwd: string | null): void {
	const handoff = useNotesHandoff(cwd);
	const { blockedReason } = handoff;
	/**
	 * sendAll / sendOne 每次渲染都是新函数。放进下面的依赖里，计时器就会被一次次清掉
	 * 重设，防抖永远等不到头——所以走 ref。
	 */
	const handoffRef = useRef(handoff);
	handoffRef.current = handoff;
	const [version, setVersion] = useState(0);
	useEffect(() => {
		const handle = notes.on(() => setVersion((value) => value + 1));
		return () => handle.dispose();
	}, [notes]);

	useEffect(() => {
		if (blockedReason !== null) return;
		const pending = pendingNotes(notes.notes);
		const fresh = pending.filter((note) => !notes.isDispatched(note));
		if (fresh.length === 0) return;
		// 依赖里的 version 每次落备注都会变，于是这个计时器被清掉重设——连着放几条
		// 就自然合并成最后那一次派活。
		const timer = window.setTimeout(() => {
			notes.markDispatched(fresh);
			// 单条时把 id 指出来，agent 直接按 id 取；多条就让它拉全部待处理的——
			// 已经派过但还没做完的那些，本来也该一起收拾掉。
			if (pending.length === 1) handoffRef.current.sendOne(pending[0].id);
			else handoffRef.current.sendAll(pending.length);
		}, AUTO_DISPATCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [blockedReason, notes, version]);
}
