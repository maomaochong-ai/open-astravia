/**
 * 备注面板与备注工具是同一个状态。这里锁住那条契约的可测部分：面板的关闭动作
 * 走的是「退回选择工具」，而不是某个独立的面板开关——顶部那个独立按钮已经去掉，
 * 若哪天有人给面板加回自己的可见性 state，工具与面板就会各说各话。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	usePromptAttachment: () => null,
}));

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		conversation: { on: () => ({ dispose: () => {} }), sendPrompt: () => Promise.resolve() },
	}),
	notify: () => {},
}));

import { act } from "react";
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { createRoot, type Root } from "react-dom/client";
import { NotesDrawer } from "../src/canvas/NotesDrawer";
import { NotesStore } from "../src/notes/notes-store";
import type { DesignSession } from "../src/vetd/design-session";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let store: NotesStore;

const fs = {
	readFile: () => Promise.reject(new Error("ENOENT")),
	writeFile: () => Promise.resolve(),
} as unknown as PluginFsApi;

/** 面板只用到 manifest.frames（解析所属画框标题）与变更订阅。 */
const session = {
	manifest: { frames: [{ id: "login", title: "登录页" }] },
	on: () => ({ dispose: () => {} }),
} as unknown as DesignSession;

beforeEach(async () => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	store = new NotesStore(fs, "/design.vetd.d");
	await store.load();
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function render(onClose: () => void = () => {}, onLocate: (id: string) => void = () => {}): void {
	act(() => {
		root.render(
			<NotesDrawer store={store} session={session} cwd="/repo" onLocate={onLocate} onClose={onClose} />,
		);
	});
}

function clickByLabel(label: string): void {
	const element = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
	if (!element) throw new Error(`no element labelled ${label}`);
	act(() => element.click());
}

it("closing the panel is a single callback — it owns no visibility state of its own", () => {
	let closed = 0;
	render(() => {
		closed += 1;
	});
	clickByLabel("notes.close");
	expect(closed).toBe(1);
	// 面板自身没有隐藏：它渲染与否完全由外层的工具态决定。
	expect(document.body.querySelector(".vetd-note-drawer-enter")).not.toBeNull();
});

it("splits notes into pending and resolved, numbering only the pending ones", () => {
	const first = store.addNote({ kind: "frame", frameId: "login", fx: 10, fy: 20 }, "按钮太小");
	store.addNote({ kind: "free", x: 5, y: 5 }, "整体更紧凑");
	store.appendMessage(first.id, "agent", "已放大到 44px");
	render();

	const text = document.body.textContent ?? "";
	expect(text).toContain("notes.drawer.pending");
	expect(text).toContain("notes.drawer.resolved");
	// 已处理那条带上了 Vetta 的回复摘要
	expect(text).toContain("已放大到 44px");
	// 唯一的待处理备注编号为 1（已处理的不参与编号）
	expect(text).toContain("整体更紧凑");
});

it("locating a note reports its id so the canvas can center on it", () => {
	const note = store.addNote({ kind: "frame", frameId: "login", fx: 1, fy: 2 }, "这里改蓝色");
	const located: string[] = [];
	render(() => {}, (id) => located.push(id));

	const row = [...document.body.querySelectorAll("button")].find((button) =>
		(button.textContent ?? "").includes("这里改蓝色"),
	);
	if (!row) throw new Error("note row not rendered");
	act(() => row.click());
	expect(located).toEqual([note.id]);
});

it("clearing resolved notes keeps the pending ones", () => {
	const done = store.addNote({ kind: "free", x: 0, y: 0 }, "已完成的");
	store.appendMessage(done.id, "agent", "改好了");
	const open = store.addNote({ kind: "free", x: 0, y: 0 }, "还没处理的");
	render();

	const clear = [...document.body.querySelectorAll("button")].find(
		(button) => button.textContent === "notes.drawer.clearResolved",
	);
	if (!clear) throw new Error("clear button not rendered");
	act(() => clear.click());
	expect(store.notes.map((note) => note.id)).toEqual([open.id]);
});
