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
 *
 * `no-conversation` 指的是连该在哪个 workspace 开会话都不知道（画布没有 cwd）。
 * 单纯「宿主此刻没有活跃会话」不算阻断——那正是用户停在新会话页的样子，派活时
 * 自己起一个就是了。
 */
export type NotesHandoffBlock = "no-conversation" | "other-workspace" | "streaming";

export interface NotesHandoff {
	/** null = 可以发送。 */
	blocked: NotesHandoffBlock | null;
	/** null = 可以发送；否则是禁用原因（已本地化，直接展示）。 */
	blockedReason: string | null;
	sendAll(): void;
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

	/**
	 * 没有活跃会话不等于发不出去：用户停在新会话页时宿主就是这个状态，而画布自己
	 * 知道 cwd，可以先起一个会话再说话（`sendNeedsSession`）。真正没辙的只有连
	 * cwd 都没有——那时不知道该在哪儿开。
	 */
	const sendNeedsSession = !conversation?.cwd && cwd !== null;

	const blocked: NotesHandoffBlock | null = sendNeedsSession
		? null
		: !conversation?.cwd
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
		const conversationApi = getPluginCtx().conversation;
		const fail = (error: unknown): void => notify({ message: t("notes.handoff.failed"), error });
		if (sendNeedsSession && cwd !== null) {
			// createSession resolve 时会话已就绪，可以直接接 sendPrompt。
			void conversationApi
				.createSession(cwd)
				.then(() => conversationApi.sendPrompt(prompt))
				.catch(fail);
			return;
		}
		void conversationApi.sendPrompt(prompt).catch(fail);
	};

	return {
		blocked,
		blockedReason,
		// 派活 prompt 面向模型，不走 i18n：与工具 description、附件 instructions 同类，
		// 一律英文。备注内容本身是用户写的，agent 用什么语言回复跟着它走。
		sendAll: () => send(dispatchAllPrompt()),
		sendOne: (noteId) => send(dispatchOnePrompt(noteId)),
	};
}

/**
 * 派活 prompt。刻意不提 `ids`：一次事故里派活说了「ids 传入该 id」，agent 老老实实
 * 只查了那一条，从头到尾没列过全量待办，于是用户在它干活期间新贴的两条被整轮无视。
 * 让它自己列全量，视野就不会被这句话锁死。
 */
function dispatchAllPrompt(): string {
	return [
		// 刻意不写数量：它是发出这条消息那一刻的快照，而用户随时还在往画布上贴。
		// 写死「3 条」等于给了 agent 一个做完就收工的借口。数量只能实时查。
		"The user has pinned notes on the design canvas.",
		"Call vetd_notes with no arguments to list every pending note — each comes with its position, a freshly re-resolved source anchor, and an annotated screenshot.",
		"Work through them ONE AT A TIME: make the change, verify it with vetd_screenshot, then resolve that single note before starting the next.",
		"Each resolve tells you what is still pending — keep going until it reports `pendingRemaining: 0`, including notes the user adds while you work.",
		"Write each reply in the language the user wrote that note in.",
	].join(" ");
}

/** 抽屉里「处理这一条」：用户点名了某一条，带 id 只读它（省掉逐帧拉活体截图）。 */
function dispatchOnePrompt(noteId: string): string {
	return [
		`Handle the note pinned on the design canvas with id \`${noteId}\`:`,
		"call vetd_notes with that id to see its position, anchor and annotated screenshot, make the change, verify it with vetd_screenshot, then resolve it.",
		"The resolve reports whatever is still pending — if anything is, handle those too before you finish.",
		"Write your reply in the language the user wrote the note in.",
	].join(" ");
}

/**
 * 落下备注后等这么久再派活。用户往往连着放好几条，一放下就叫 agent 的话，第一条
 * 会立刻把会话占住，第二条起全都堵在「它正忙」里。期间又放了就重新计时。
 */
const AUTO_DISPATCH_DEBOUNCE_MS = 1_500;

/**
 * 备注自动派活：只要会话空闲，新落下的（以及重开的）备注就自己交给 agent，不必等
 * 用户去点「让 Vetta 处理」。宿主还停在新会话页（没有活跃会话）时也照派——先建一个
 * 会话再说话，否则「贴了备注左边却毫无动静」。
 *
 * 「新」的界限由 store 划：load 时磁盘上的存量全部记成已交付，所以打开一个设计稿
 * 不会因为上面躺着旧备注就凭空发起一轮工作。
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
		// 会话在别的 workspace（或画布连 cwd 都没有）：没有人会来自检，所以留着不动，
		// 等闸口放行的那一刻再派出去。宿主此刻没有活跃会话不在此列——那种情况派活时
		// 自己起一个会话（见 useNotesHandoff 的 sendNeedsSession）。
		if (blocked !== null) return;
		// 依赖里的 version 每次落备注都会变，于是这个计时器被清掉重设——连着放几条
		// 就自然合并成最后那一次派活。
		const timer = window.setTimeout(() => {
			notes.markDispatched(fresh);
			// 一律走全量，哪怕此刻只有一条：带 id 的那条 prompt 会把 agent 的视野锁死在
			// 那一条上（它就照着 ids 查，再不看别的），而用户随时可能在它干活期间再贴。
			handoffRef.current.sendAll();
		}, AUTO_DISPATCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [blocked, notes, version]);
}
