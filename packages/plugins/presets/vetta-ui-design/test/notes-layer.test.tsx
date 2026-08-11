/**
 * 备注输入框的按键语义。重点是输入法组合期：中文输入「badge」时候选框还开着，
 * 这时的 Enter 是「选中候选词」、Esc 是「取消这次组合」，都不能被当成提交/关闭
 * ——否则用户打一半的拼音就被发出去了。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	usePromptAttachment: () => null,
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { NotesLayer } from "../src/canvas/NotesLayer";
import { NotesStore } from "../src/notes/notes-store";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let store: NotesStore;

const fs = {
	readFile: () => Promise.reject(new Error("ENOENT")),
	writeFile: () => Promise.resolve(),
} as unknown as PluginFsApi;

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

/** 渲染一个「刚点下画布、草稿输入框开着」的备注层。 */
function renderDraft(blockedReason: string | null = null): { textarea: HTMLTextAreaElement; closed: () => number } {
	let closeCount = 0;
	act(() => {
		root.render(
			<NotesLayer
				store={store}
				frames={[]}
				interactive
				draft={{ world: { x: 10, y: 20 }, frameId: null, fx: 0, fy: 0, hit: null }}
				blockedReason={blockedReason}
				onDraftClose={() => {
					closeCount += 1;
				}}
				openNoteId={null}
				onOpenNote={() => {}}
				getZoom={() => 1}
			/>,
		);
	});
	const textarea = document.body.querySelector("textarea");
	if (!textarea) throw new Error("composer textarea not rendered");
	return { textarea, closed: () => closeCount };
}

function type(textarea: HTMLTextAreaElement, value: string): void {
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		setter?.call(textarea, value);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function pressEnter(textarea: HTMLTextAreaElement, init?: KeyboardEventInit): void {
	act(() => {
		textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...init }));
	});
}

it("Enter submits the note when no IME session is active", () => {
	const { textarea } = renderDraft();
	type(textarea, "按钮太小");
	pressEnter(textarea);
	expect(store.notes).toHaveLength(1);
	expect(store.notes[0].messages[0].text).toBe("按钮太小");
});

it("Enter picks the IME candidate instead of submitting while composing", () => {
	const { textarea, closed } = renderDraft();
	act(() => {
		textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
	});
	// 输入法里打了 "badge"，候选框开着 —— 这一下 Enter 属于输入法。
	type(textarea, "badge");
	pressEnter(textarea);
	expect(store.notes).toHaveLength(0);
	expect(closed()).toBe(0);
});

it("still ignores Enter right after compositionend (candidate confirmation)", () => {
	const { textarea } = renderDraft();
	act(() => {
		textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
	});
	type(textarea, "徽标");
	// 引擎之间 compositionend 与 keydown 的先后不一致：确认候选词那一下就落在这个缝里。
	act(() => {
		textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
	});
	pressEnter(textarea);
	expect(store.notes).toHaveLength(0);
});

it("Escape while composing cancels the IME session, not the draft", () => {
	const { textarea, closed } = renderDraft();
	act(() => {
		textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
	});
	type(textarea, "hui");
	act(() => {
		textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	});
	expect(closed()).toBe(0);
});

it("Escape closes the draft when no IME session is active", () => {
	const { textarea, closed } = renderDraft();
	act(() => {
		textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	});
	expect(closed()).toBe(1);
	expect(store.notes).toHaveLength(0);
});

it("Shift+Enter inserts a newline instead of submitting", () => {
	const { textarea } = renderDraft();
	type(textarea, "第一行");
	pressEnter(textarea, { shiftKey: true });
	expect(store.notes).toHaveLength(0);
});

it("focuses the composer on open, and takes the focus back if something steals it", async () => {
	const { textarea } = renderDraft();
	expect(document.activeElement).toBe(textarea);
	// 画布是在 pointerdown 里挂出浮层的，随后那次 mousedown 的默认动作会把焦点交给
	// 画布容器——挂载时抢到的焦点当场被夺走。下一帧必须把它夺回来。
	act(() => {
		host.tabIndex = 0;
		host.focus();
	});
	expect(document.activeElement).not.toBe(textarea);
	await act(async () => {
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
	});
	expect(document.activeElement).toBe(textarea);
});

it("wears the same chrome as the selection ask popover: 落点标题 + 随闸口切换的文案", () => {
	renderDraft();
	expect(document.body.textContent).toContain("notes.drawer.freeNote");
	expect(document.body.querySelector("textarea")?.placeholder).toBe("canvas.ask.placeholder");

	act(() => root.unmount());
	root = createRoot(host);
	renderDraft("notes.handoff.streaming");
	// agent 正忙：改口成「留个备注」，并说明为什么。
	expect(document.body.querySelector("textarea")?.placeholder).toBe("canvas.ask.note.placeholder");
	expect(document.body.textContent).toContain("canvas.ask.note.hint");
});
