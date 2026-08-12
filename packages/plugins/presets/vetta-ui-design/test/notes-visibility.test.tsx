/**
 * 备注显隐：顶栏开关是唯一能隐藏的入口，自动规则只往「显示」推。
 * 这里盯三件事——开关的可读状态、只开不关的语义、隐藏时画布上到底还剩什么。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	usePromptAttachment: () => null,
}));

import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotesLayer } from "../src/canvas/NotesLayer";
import { NotesVisibilitySwitch } from "../src/canvas/NotesVisibilitySwitch";
import { NotesStore } from "../src/notes/notes-store";
import { useNotesVisibility, type NotesVisibility } from "../src/notes/notes-visibility";

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

function bubbles(): HTMLElement[] {
	return [...host.querySelectorAll('[aria-label="notes.bubble.label"]')] as HTMLElement[];
}

function renderLayer(visible: boolean, openNoteId: string | null, withDraft: boolean): void {
	act(() => {
		root.render(
			<NotesLayer
				store={store}
				frames={[]}
				interactive
				visible={visible}
				draft={withDraft ? { world: { x: 10, y: 20 }, frameId: null, fx: 0, fy: 0, hit: null } : null}
				blockedReason={null}
				onDraftClose={() => {}}
				openNoteId={openNoteId}
				onOpenNote={() => {}}
				getZoom={() => 1}
			/>,
		);
	});
}

it("隐藏时气泡与 thread 都不渲染，显示时回来", () => {
	const note = store.addNote({ kind: "free", x: 0, y: 0 }, "改成蓝色");

	renderLayer(true, note.id, false);
	expect(bubbles()).toHaveLength(1);
	expect(host.textContent).toContain("改成蓝色");

	renderLayer(false, note.id, false);
	expect(bubbles()).toHaveLength(0);
	// thread 弹层跟着气泡一起收——气泡都不在了，悬空的弹层没有归属。
	expect(host.textContent).not.toContain("改成蓝色");

	renderLayer(true, note.id, false);
	expect(bubbles()).toHaveLength(1);
});

it("隐藏不影响正在输入的草稿：那是还没落下的备注", () => {
	store.addNote({ kind: "free", x: 0, y: 0 }, "已有备注");
	renderLayer(false, null, true);
	expect(bubbles()).toHaveLength(0);
	expect(host.querySelector("textarea")).not.toBeNull();
});

/** 把 hook 的返回值抛给测试用例。 */
function VisibilityProbe({ onState }: { onState(state: NotesVisibility): void }) {
	onState(useNotesVisibility());
	return null;
}

function renderVisibility(): () => NotesVisibility {
	let latest: NotesVisibility | null = null;
	act(() => {
		root.render(
			<VisibilityProbe
				onState={(state) => {
					latest = state;
				}}
			/>,
		);
	});
	return () => {
		if (!latest) throw new Error("probe not rendered");
		return latest;
	};
}

it("默认显示；show 只开不关，toggle 是唯一的隐藏入口", () => {
	const state = renderVisibility();
	expect(state().visible).toBe(true);

	// 已经显示时 show 是空操作。
	act(() => state().show());
	expect(state().visible).toBe(true);

	act(() => state().toggle());
	expect(state().visible).toBe(false);

	// 自动规则（切到备注工具 / 落下备注 / 列表定位）走的都是 show：手动隐藏后仍能被拉回来。
	act(() => state().show());
	expect(state().visible).toBe(true);
});

it("开关按 role=switch 暴露状态，点击回调翻转显隐", () => {
	let toggles = 0;
	act(() => {
		root.render(<NotesVisibilitySwitch visible onToggle={() => (toggles += 1)} />);
	});
	const control = host.querySelector('[role="switch"]') as HTMLButtonElement;
	expect(control.getAttribute("aria-checked")).toBe("true");
	expect(control.getAttribute("aria-label")).toBe("notes.visibility.hide");

	act(() => control.click());
	expect(toggles).toBe(1);

	act(() => {
		root.render(<NotesVisibilitySwitch visible={false} onToggle={() => {}} />);
	});
	const off = host.querySelector('[role="switch"]') as HTMLButtonElement;
	expect(off.getAttribute("aria-checked")).toBe("false");
	expect(off.getAttribute("aria-label")).toBe("notes.visibility.show");
});
