import type { VetdFrameEntry } from "../vetd/manifest-types";

/**
 * 备注锚点，三态。放置那一刻冻结（ADR 式约定：坐标只是中间产物，交给 agent 的
 * 是元素快照）：
 *
 * - element：命中了 frame 内某个 DOM 元素。fx/fy 是 frame 内坐标（frame 声明尺寸
 *   的像素系），element 是命中瞬间的元素快照（source 即 `frames/x.tsx:42`）。
 * - frame：落在 frame 上但没解析出元素（或解析还没完成）。
 * - free：落在空白画布上，世界坐标。detachedFrom 非空表示它原本锚在某个 frame 上、
 *   后来 frame 没了（删除/重命名），降级而来。
 */
export type NoteAnchor =
	| { kind: "element"; frameId: string; fx: number; fy: number; element: NoteElementAnchor }
	| { kind: "frame"; frameId: string; fx: number; fy: number }
	| { kind: "free"; x: number; y: number; detachedFrom?: string };

/** 放置/刷新时从引擎 bridge 拿到的元素快照。 */
export interface NoteElementAnchor {
	domPath: string;
	tag: string;
	text: string;
	classes: string;
	/** `frames/login.tsx:42`（编译期注入），生产构建下可能为 null。 */
	source: string | null;
}

export interface NoteMessage {
	author: "user" | "agent";
	text: string;
	at: number;
}

/**
 * 一条备注 = 锚点 + 轻量 thread。状态不单独存：末条消息是 user 就是待处理，
 * 是 agent 就是已处理；重开 = 追加一条 user 消息。
 */
export interface DesignNote {
	id: string;
	anchor: NoteAnchor;
	messages: NoteMessage[];
	createdAt: number;
}

/** `.notes.json` 的持久化形态（插件是唯一写者，agent 走 vetd_notes 工具）。 */
export interface NotesFile {
	version: 1;
	notes: DesignNote[];
}

export type NoteStatus = "pending" | "resolved";

export function noteStatus(note: DesignNote): NoteStatus {
	const last = note.messages[note.messages.length - 1];
	return last?.author === "agent" ? "resolved" : "pending";
}

/**
 * 备注最后一次有动静的时刻（末条消息，没有消息就退回创建时间）。
 *
 * 状态本来就是从末条消息推导的（user = 待处理，agent = 已处理），排序跟着末条走
 * 才和它是同一套心智：重开一条旧备注 = 「我现在又提了一遍」，那它就是一件新的待办。
 * 按创建时间排的话，重开的旧备注会带着最初的时间插到队首，把用户刚写下的那条挤到
 * 后面去——而编号既显示在画布气泡上，也决定 agent 逐条处理的顺序。
 */
export function noteActivityAt(note: DesignNote): number {
	return note.messages[note.messages.length - 1]?.at ?? note.createdAt;
}

/** 待处理备注，按进入待处理的时间排序——画布气泡编号与 vetd_notes 返回列表共用这个序。 */
export function pendingNotes(notes: readonly DesignNote[]): DesignNote[] {
	return notes.filter((note) => noteStatus(note) === "pending").sort((a, b) => noteActivityAt(a) - noteActivityAt(b));
}

/** 已处理备注，按被处理的时间排序（末条消息就是 agent 的那条回复）。 */
export function resolvedNotes(notes: readonly DesignNote[]): DesignNote[] {
	return notes.filter((note) => noteStatus(note) === "resolved").sort((a, b) => noteActivityAt(a) - noteActivityAt(b));
}

/** 备注在世界坐标系里的位置（画气泡、降级换算都用它）。 */
export function noteWorldPosition(
	note: DesignNote,
	frameOf: (frameId: string) => Pick<VetdFrameEntry, "x" | "y"> | undefined,
): { x: number; y: number } {
	const { anchor } = note;
	if (anchor.kind === "free") return { x: anchor.x, y: anchor.y };
	const frame = frameOf(anchor.frameId);
	// frame 找不到时的兜底：把 frame 内坐标当世界坐标（降级流程正常时走不到这里）。
	if (!frame) return { x: anchor.fx, y: anchor.fy };
	return { x: frame.x + anchor.fx, y: frame.y + anchor.fy };
}

/**
 * frame 消失（删除/重命名）后把锚在它上面的备注降级为自由备注。
 * `lastRect` 是 frame 消失前最后一次已知的位置，用它把 frame 内坐标换算回世界坐标；
 * 拿不到（插件重启后才发现悬空）就退化成 frame 内坐标当世界坐标。
 */
export function demoteAnchor(anchor: NoteAnchor, lastRect: { x: number; y: number } | null): NoteAnchor {
	if (anchor.kind === "free") return anchor;
	return {
		kind: "free",
		x: (lastRect?.x ?? 0) + anchor.fx,
		y: (lastRect?.y ?? 0) + anchor.fy,
		detachedFrom: anchor.frameId,
	};
}

export function parseNotesFile(raw: string): NotesFile {
	try {
		const parsed = JSON.parse(raw) as NotesFile;
		if (parsed && parsed.version === 1 && Array.isArray(parsed.notes)) {
			return { version: 1, notes: parsed.notes.filter((note) => note && note.messages.length > 0) };
		}
	} catch {
		// corrupt → start empty; the store persists a clean file on next write
	}
	return { version: 1, notes: [] };
}
