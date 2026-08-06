/**
 * 按作用域隔离的输入草稿 + 已发送历史。
 *
 * 工作集（inputValue / selectedSkill / appshot）仍是全局 atom——同一时刻只有一个
 * InputBar。本模块在「切换作用域」时把当前工作集落入 map、再灌入目标作用域草稿，
 * 避免新会话写到一半去看别的会话回来内容丢失，也避免草稿串到别的会话。
 *
 * 作用域 key：
 * - 已有会话：`sessionPath`（与 input-action 持久化一致）
 * - 新会话页：`new:${cwd}`（尚无 sessionPath）
 *
 * 仅内存：跨进程/刷新不恢复。附件路径与 token 在长会话间足够用，不必进 localStorage。
 */

import { deriveAttachments, parseInputSegments } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import { atom, getDefaultStore } from "jotai";
import {
	type AppshotAttachment,
	appshotAttachmentAtom,
	attachedImagesAtom,
	inputValueAtom,
	type MentionedFile,
	mentionedFilesAtom,
	type SelectedSkill,
	selectedSkillAtom,
} from "./chat-atoms";
import { appendInputHistoryEntry, isSessionInputDraftEmpty } from "./session-input-draft-logic";

export {
	appendInputHistoryEntry,
	INPUT_HISTORY_MAX,
	isSessionInputDraftEmpty,
	newSessionInputDraftKey,
} from "./session-input-draft-logic";

export interface SessionInputDraft {
	text: string;
	selectedSkill: SelectedSkill | null;
	appshot: AppshotAttachment | null;
}

/** sessionPath 或 `new:${cwd}` → 未发送草稿。 */
const sessionInputDraftMapBaseAtom = atom<Record<string, SessionInputDraft>>({});

/** sessionPath 或 `new:${cwd}` → 已发送文本（旧→新）。 */
const sessionInputHistoryMapBaseAtom = atom<Record<string, string[]>>({});

/**
 * 当前工作集归属的草稿作用域。
 * null = 尚未绑定（启动瞬间）；切换会话 / 进新会话页时更新。
 */
export const activeInputDraftKeyAtom = atom<string | null>(null);

export const sessionInputDraftMapAtom = atom(
	(get) => get(sessionInputDraftMapBaseAtom),
	(_get, set, next: Record<string, SessionInputDraft>) => {
		set(sessionInputDraftMapBaseAtom, next);
	},
);

export const sessionInputHistoryMapAtom = atom(
	(get) => get(sessionInputHistoryMapBaseAtom),
	(_get, set, next: Record<string, string[]>) => {
		set(sessionInputHistoryMapBaseAtom, next);
	},
);

export function emptySessionInputDraft(): SessionInputDraft {
	return { text: "", selectedSkill: null, appshot: null };
}

export function captureSessionInputDraft(): SessionInputDraft {
	const store = getDefaultStore();
	return {
		text: store.get(inputValueAtom),
		selectedSkill: store.get(selectedSkillAtom),
		appshot: store.get(appshotAttachmentAtom),
	};
}

export function applySessionInputDraft(draft: SessionInputDraft): void {
	const store = getDefaultStore();
	store.set(inputValueAtom, draft.text);
	store.set(selectedSkillAtom, draft.selectedSkill);
	store.set(appshotAttachmentAtom, draft.appshot);
	// 附图已并入文本 token；旧 atom 仅兜底清空，避免串会话。
	store.set(attachedImagesAtom, []);
	// 无编辑器时也要从文本还原 @ 文件，避免发送链路读到上一会话残留。
	const files: MentionedFile[] = deriveAttachments(parseInputSegments(draft.text).segments).map((attachment) => ({
		path: attachment.path,
		name: pathBasename(attachment.path),
		isDirectory: attachment.kind === "directory",
	}));
	store.set(mentionedFilesAtom, files);
}

/** 写入 map；空草稿删键，避免 map 无限膨胀。 */
export function persistSessionInputDraft(key: string, draft: SessionInputDraft): void {
	if (!key) return;
	const store = getDefaultStore();
	const prev = store.get(sessionInputDraftMapAtom);
	if (isSessionInputDraftEmpty(draft)) {
		if (!(key in prev)) return;
		const next = { ...prev };
		delete next[key];
		store.set(sessionInputDraftMapAtom, next);
		return;
	}
	const existing = prev[key];
	if (
		existing &&
		existing.text === draft.text &&
		existing.selectedSkill === draft.selectedSkill &&
		existing.appshot === draft.appshot
	) {
		return;
	}
	store.set(sessionInputDraftMapAtom, { ...prev, [key]: draft });
}

export function loadSessionInputDraft(key: string): SessionInputDraft {
	if (!key) return emptySessionInputDraft();
	return getDefaultStore().get(sessionInputDraftMapAtom)[key] ?? emptySessionInputDraft();
}

/** 把当前工作集落到 active key（key 为空则 no-op）。 */
export function persistCurrentSessionInputDraft(): void {
	const key = getDefaultStore().get(activeInputDraftKeyAtom);
	if (!key) return;
	persistSessionInputDraft(key, captureSessionInputDraft());
}

/**
 * 切换草稿作用域：先落盘当前，再装入目标（无则空）。
 * 同 key 不重复装载，避免无谓重写编辑器。
 */
export function switchSessionInputDraftScope(nextKey: string | null): void {
	const store = getDefaultStore();
	const prevKey = store.get(activeInputDraftKeyAtom);
	if (prevKey === nextKey) return;

	if (prevKey) {
		persistSessionInputDraft(prevKey, captureSessionInputDraft());
	}

	if (nextKey) {
		applySessionInputDraft(loadSessionInputDraft(nextKey));
	} else {
		applySessionInputDraft(emptySessionInputDraft());
	}

	store.set(activeInputDraftKeyAtom, nextKey);
}

/**
 * 打开「已有」会话：落盘当前工作集，装入目标 sessionPath 草稿。
 * sessionPath 为空时只落盘、不换 key（early open 尚未解析出路径）。
 */
export function adoptExistingSessionInputDraft(sessionPath: string): void {
	if (!sessionPath) {
		persistCurrentSessionInputDraft();
		return;
	}
	switchSessionInputDraftScope(sessionPath);
}

/**
 * 新建会话首条落地真实 path：工作集保留给随后的 sendMessage，
 * 只改归属 key，并丢掉 `new:${cwd}` 上的挂起草稿（已迁到真实 path）。
 */
export function claimNewSessionInputDraft(sessionPath: string, newSessionKey: string | null): void {
	if (!sessionPath) return;
	const store = getDefaultStore();
	// 落盘一次当前工作集到旧 key（通常是 new:cwd），再挂到真实 path。
	const prevKey = store.get(activeInputDraftKeyAtom);
	if (prevKey) {
		persistSessionInputDraft(prevKey, captureSessionInputDraft());
	}
	// 把当前内容也记到真实 path，发送清空后 path 下为空。
	persistSessionInputDraft(sessionPath, captureSessionInputDraft());
	store.set(activeInputDraftKeyAtom, sessionPath);

	if (newSessionKey && newSessionKey !== sessionPath) {
		const map = store.get(sessionInputDraftMapAtom);
		if (newSessionKey in map) {
			const next = { ...map };
			delete next[newSessionKey];
			store.set(sessionInputDraftMapAtom, next);
		}
	}
}

/** 发送成功后：清空工作集 + 当前 key 的 map 条目。 */
export function clearCurrentSessionInputDraft(): void {
	const store = getDefaultStore();
	const key = store.get(activeInputDraftKeyAtom);
	applySessionInputDraft(emptySessionInputDraft());
	if (key) {
		persistSessionInputDraft(key, emptySessionInputDraft());
	}
}

// ─── 已发送历史（↑ / ↓） ───────────────────────────────────────────

export function getSessionInputHistory(key: string | null | undefined): string[] {
	if (!key) return [];
	return getDefaultStore().get(sessionInputHistoryMapAtom)[key] ?? [];
}

export function pushSessionInputHistory(key: string | null | undefined, text: string): void {
	if (!key) return;
	const trimmed = text.trim();
	if (!trimmed) return;
	const store = getDefaultStore();
	const map = store.get(sessionInputHistoryMapAtom);
	const prev = map[key] ?? [];
	const next = appendInputHistoryEntry(prev, trimmed);
	if (next.length === prev.length && next.every((item, i) => item === prev[i])) return;
	store.set(sessionInputHistoryMapAtom, { ...map, [key]: next });
}

/**
 * 发送后推历史并清草稿。override 发送（建议气泡等）不碰草稿/历史。
 */
export function recordSentInputAndClearDraft(text: string): void {
	const key = getDefaultStore().get(activeInputDraftKeyAtom);
	pushSessionInputHistory(key, text);
	clearCurrentSessionInputDraft();
}
