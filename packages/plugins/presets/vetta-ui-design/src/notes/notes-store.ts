import type { Disposable, PluginFsApi } from "@vetta-org/plugin-sdk";
import {
	type DesignNote,
	demoteAnchor,
	type NoteAnchor,
	type NoteElementAnchor,
	type NotesFile,
	noteStatus,
	parseNotesFile,
} from "./types";

/**
 * 点前缀是刻意的：引擎的目录监听跳过一切点开头的路径段（否则每写一次备注就
 * full-reload），画布的 mtime 重扫与导出分享包也按同名排除。
 */
export const NOTES_FILE_NAME = ".notes.json";

export function notesFilePath(dirPath: string): string {
	return `${dirPath}/${NOTES_FILE_NAME}`;
}

let idCounter = 0;

function nextNoteId(): string {
	idCounter += 1;
	return `note-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * 一份设计的备注。单写者：画布 UI 和 vetd_notes 工具都通过这里做定点 patch，
 * `.notes.json` 永远不被整体覆盖，用户在 agent 干活期间新加的备注不可能被抹掉。
 * 写盘与 DesignSession.persist 同一套串行化。
 */
export class NotesStore {
	private readonly fs: PluginFsApi;
	private readonly path: string;
	private file: NotesFile = { version: 1, notes: [] };
	private readonly listeners = new Set<() => void>();
	private writing = Promise.resolve();

	constructor(fs: PluginFsApi, dirPath: string) {
		this.fs = fs;
		this.path = notesFilePath(dirPath);
	}

	async load(): Promise<void> {
		try {
			this.file = parseNotesFile((await this.fs.readFile(this.path)).content);
		} catch {
			this.file = { version: 1, notes: [] };
		}
		this.emit();
	}

	/** 只摘监听，不截断写队列——关画布前最后一笔 patch 也要落盘。 */
	dispose(): void {
		this.listeners.clear();
	}

	get notes(): readonly DesignNote[] {
		return this.file.notes;
	}

	noteById(id: string): DesignNote | undefined {
		return this.file.notes.find((note) => note.id === id);
	}

	on(listener: () => void): Disposable {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	private commit(notes: DesignNote[]): void {
		this.file = { version: 1, notes };
		this.emit();
		this.persist();
	}

	/** 按 id 定点替换。id 不存在时原样返回（调用方不必先查存在性）。 */
	private patch(id: string, apply: (note: DesignNote) => DesignNote): boolean {
		let changed = false;
		const notes = this.file.notes.map((note) => {
			if (note.id !== id) return note;
			changed = true;
			return apply(note);
		});
		if (changed) this.commit(notes);
		return changed;
	}

	addNote(anchor: NoteAnchor, text: string): DesignNote {
		const now = Date.now();
		const note: DesignNote = {
			id: nextNoteId(),
			anchor,
			messages: [{ author: "user", text, at: now }],
			createdAt: now,
		};
		this.commit([...this.file.notes, note]);
		return note;
	}

	/** 追加一条消息（user = 重开/补充，agent = 回复即已处理）。 */
	appendMessage(id: string, author: "user" | "agent", text: string): boolean {
		return this.patch(id, (note) => ({
			...note,
			messages: [...note.messages, { author, text, at: Date.now() }],
		}));
	}

	deleteNote(id: string): void {
		const notes = this.file.notes.filter((note) => note.id !== id);
		if (notes.length !== this.file.notes.length) this.commit(notes);
	}

	clearResolved(): void {
		const notes = this.file.notes.filter((note) => noteStatus(note) === "pending");
		if (notes.length !== this.file.notes.length) this.commit(notes);
	}

	/** 拖动气泡：element/frame 锚改 frame 内坐标，free 锚改世界坐标。 */
	moveNote(id: string, position: { x: number; y: number }): void {
		this.patch(id, (note) => ({
			...note,
			anchor:
				note.anchor.kind === "free"
					? { ...note.anchor, x: position.x, y: position.y }
					: { ...note.anchor, fx: position.x, fy: position.y },
		}));
	}

	/**
	 * 放置时的后台 hit-test 落地，或 vetd_notes 读取时的锚点保鲜：把 frame 锚升级成
	 * 元素锚 / 刷新元素快照。free 锚不动——它没有元素语义。
	 */
	upgradeAnchor(id: string, element: NoteElementAnchor): void {
		this.patch(id, (note) =>
			note.anchor.kind === "free" ? note : { ...note, anchor: { ...note.anchor, kind: "element", element } },
		);
	}

	/** frame 消失（删除/重命名）：锚在它上面的备注降级为自由备注并标记来源。 */
	demoteFrame(frameId: string, lastRect: { x: number; y: number } | null): void {
		let changed = false;
		const notes = this.file.notes.map((note) => {
			if (note.anchor.kind === "free" || note.anchor.frameId !== frameId) return note;
			changed = true;
			return { ...note, anchor: demoteAnchor(note.anchor, lastRect) };
		});
		if (changed) this.commit(notes);
	}

	private persist(): void {
		const snapshot = `${JSON.stringify(this.file, null, "\t")}\n`;
		this.writing = this.writing
			.then(() => this.fs.writeFile(this.path, snapshot))
			.catch((error: unknown) => {
				console.error("vetd notes write failed", error);
			});
	}

	/** 测试与工具侧等待写盘落定。 */
	flush(): Promise<void> {
		return this.writing;
	}
}
