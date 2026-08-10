/**
 * 备注数据层：状态由末条消息推导、编号与列表同序、孤儿降级换算、store 的定点
 * patch（agent 回写期间用户新加的备注不能被抹掉——这是「插件单写」承诺的核心）。
 */
import { expect, it } from "vitest";
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { NotesStore, notesFilePath } from "../src/notes/notes-store";
import {
	demoteAnchor,
	noteStatus,
	noteWorldPosition,
	parseNotesFile,
	pendingNotes,
	type DesignNote,
} from "../src/notes/types";

function fakeFs(): { fs: PluginFsApi; files: Map<string, string> } {
	const files = new Map<string, string>();
	const fs = {
		readFile: (path: string) => {
			const content = files.get(path);
			if (content === undefined) return Promise.reject(new Error("ENOENT"));
			return Promise.resolve({ content });
		},
		writeFile: (path: string, content: string) => {
			files.set(path, content);
			return Promise.resolve();
		},
	} as unknown as PluginFsApi;
	return { fs, files };
}

function note(id: string, authors: ("user" | "agent")[], createdAt = 0): DesignNote {
	return {
		id,
		anchor: { kind: "frame", frameId: "login", fx: 10, fy: 20 },
		messages: authors.map((author, index) => ({ author, text: `m${index}`, at: index })),
		createdAt,
	};
}

it("derives status from the last message author", () => {
	expect(noteStatus(note("a", ["user"]))).toBe("pending");
	expect(noteStatus(note("a", ["user", "agent"]))).toBe("resolved");
	// 重开 = 追加 user 消息，状态翻回待处理
	expect(noteStatus(note("a", ["user", "agent", "user"]))).toBe("pending");
});

it("orders pending notes by creation time (bubble numbering = list order)", () => {
	const notes = [note("b", ["user"], 2), note("c", ["user", "agent"], 1), note("a", ["user"], 0)];
	expect(pendingNotes(notes).map((n) => n.id)).toEqual(["a", "b"]);
});

it("demotes a frame anchor to a free note using the frame's last rect", () => {
	const demoted = demoteAnchor({ kind: "element", frameId: "login", fx: 30, fy: 40, element: {} as never }, { x: 100, y: 200 });
	expect(demoted).toEqual({ kind: "free", x: 130, y: 240, detachedFrom: "login" });
	// rect 丢失（插件重启后才发现悬空）退化为 frame 内坐标当世界坐标
	expect(demoteAnchor({ kind: "frame", frameId: "login", fx: 30, fy: 40 }, null)).toEqual({
		kind: "free",
		x: 30,
		y: 40,
		detachedFrom: "login",
	});
});

it("computes world position through the anchor frame", () => {
	const frameOf = () => ({ x: 500, y: 600 });
	expect(noteWorldPosition(note("a", ["user"]), frameOf)).toEqual({ x: 510, y: 620 });
});

it("parses a corrupt notes file as empty", () => {
	expect(parseNotesFile("not json").notes).toEqual([]);
	expect(parseNotesFile('{"version":2,"notes":[]}').notes).toEqual([]);
});

it("agent resolve patches in place and keeps notes added meanwhile", async () => {
	const { fs, files } = fakeFs();
	const store = new NotesStore(fs, "/design.vetd.d");
	await store.load();
	const first = store.addNote({ kind: "frame", frameId: "login", fx: 1, fy: 2 }, "按钮太小");
	// agent 干活期间用户又加了一条
	const second = store.addNote({ kind: "free", x: 5, y: 6 }, "整体再紧凑一点");
	// agent 回写第一条
	expect(store.appendMessage(first.id, "agent", "已放大到 44px")).toBe(true);
	await store.flush();

	const persisted = parseNotesFile(files.get(notesFilePath("/design.vetd.d")) ?? "");
	expect(persisted.notes).toHaveLength(2);
	expect(noteStatus(persisted.notes[0])).toBe("resolved");
	expect(persisted.notes[1].id).toBe(second.id);
	expect(noteStatus(persisted.notes[1])).toBe("pending");
});

it("clearResolved keeps pending notes only", async () => {
	const { fs } = fakeFs();
	const store = new NotesStore(fs, "/d");
	await store.load();
	const a = store.addNote({ kind: "free", x: 0, y: 0 }, "a");
	const b = store.addNote({ kind: "free", x: 0, y: 0 }, "b");
	store.appendMessage(a.id, "agent", "done");
	store.clearResolved();
	expect(store.notes.map((n) => n.id)).toEqual([b.id]);
});

it("demoteFrame only touches notes anchored to that frame", async () => {
	const { fs } = fakeFs();
	const store = new NotesStore(fs, "/d");
	await store.load();
	const anchored = store.addNote({ kind: "frame", frameId: "login", fx: 10, fy: 10 }, "x");
	const other = store.addNote({ kind: "frame", frameId: "home", fx: 1, fy: 1 }, "y");
	store.demoteFrame("login", { x: 100, y: 100 });
	expect(store.noteById(anchored.id)?.anchor).toEqual({ kind: "free", x: 110, y: 110, detachedFrom: "login" });
	expect(store.noteById(other.id)?.anchor.kind).toBe("frame");
});

it("upgradeAnchor turns a frame anchor into an element anchor but never touches free notes", async () => {
	const { fs } = fakeFs();
	const store = new NotesStore(fs, "/d");
	await store.load();
	const anchored = store.addNote({ kind: "frame", frameId: "login", fx: 10, fy: 10 }, "x");
	const free = store.addNote({ kind: "free", x: 0, y: 0 }, "y");
	const element = { domPath: "div > button", tag: "button", text: "登录", classes: "", source: "frames/login.tsx:12" };
	store.upgradeAnchor(anchored.id, element);
	store.upgradeAnchor(free.id, element);
	const upgraded = store.noteById(anchored.id)?.anchor;
	expect(upgraded?.kind).toBe("element");
	expect(upgraded?.kind === "element" ? upgraded.element.source : null).toBe("frames/login.tsx:12");
	expect(store.noteById(free.id)?.anchor.kind).toBe("free");
});
