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
/**
 * 发不出去的三种原因。要分辨它们，是因为「agent 正在跑」与另外两种有本质区别：
 * 它此刻就在射程内，收尾自检时会自己把备注捞走；另外两种则根本没有人会来取。
 */
export type NotesHandoffBlock = "no-conversation" | "other-workspace" | "streaming";

export interface NotesHandoff {
	/** null = 可以发送。 */
	blocked: NotesHandoffBlock | null;
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

	const blocked: NotesHandoffBlock | null = !conversation?.cwd
		? "no-conversation"
		: cwd !== null && conversation.cwd !== cwd
			? "other-workspace"
			: conversation.isStreaming
				? "streaming"
				: null;

	const BLOCK_MESSAGES: Record<NotesHandoffBlock, string> = {
		"no-conversation": t("notes.handoff.noConversation"),
		"other-workspace": t("notes.handoff.otherWorkspace"),
		streaming: t("notes.handoff.streaming"),
	};
	const blockedReason = blocked === null ? null : BLOCK_MESSAGES[blocked];

	const send = (prompt: string): void => {
		// sendPrompt 要整轮跑完才 resolve，不 await；发送失败单独报（与设计体系 Dialog 同型）。
		void getPluginCtx()
			.conversation.sendPrompt(prompt)
			.catch((error: unknown) => notify({ message: t("notes.handoff.failed"), error }));
	};

	return {
		blocked,
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
 * agent 正在跑的时候落下的备注一律不派，也不会等它跑完再补一条 prompt 去催——那
 * 会变成一条突兀的「继续」消息，而备注的被动特性本来就是为这个场景设计的：它收尾
 * 自检时（SKILL.md 要求报告前无条件跑一次 vetd_notes）会自己把这些捞走。
 *
 * 派过的记在 store 上（`markDispatched`），所以 agent 处理了却忘记 resolve 的备注
 * 不会被一轮轮重新派出去空转。
 */
export function useNotesAutoDispatch(notes: NotesStore, cwd: string | null): void {
	const handoff = useNotesHandoff(cwd);
	const { blocked } = handoff;
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
		const pending = pendingNotes(notes.notes);
		const fresh = pending.filter((note) => !notes.isDispatched(note));
		if (fresh.length === 0) return;
		if (blocked === "streaming") {
			/**
			 * agent 就在跑，这些备注已经在它的射程内：记成已交付，等它收尾自检时自己
			 * 捞走。不留待这轮结束后补发——用户要的是「它干完活检查时会注意到」，而不
			 * 是被一条「还有 2 条待处理」的消息追着跑。
			 *
			 * 万一它真漏了：待处理角标一直亮着，抽屉里的手动按钮可以再催一次。
			 */
			notes.markDispatched(fresh);
			return;
		}
		// 没有活跃会话 / 会话不在这个 workspace：没有人会来自检，所以留着不动，
		// 等闸口放行的那一刻再派出去。
		if (blocked !== null) return;
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
	}, [blocked, notes, version]);
}
