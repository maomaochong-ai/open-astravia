/**
 * 追问徽标的接线：提交到底做了什么。
 *
 * 纯几何与锚点构造在 selection-ask.test.ts 里；这里盯住跨了边界的部分——提交只落
 * 备注、不自己发消息（派活统一交给 useNotesAutoDispatch），以及按钮文案不会在用户
 * 打字期间被 streaming 掀翻。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

const sendPrompt = vi.fn(() => new Promise<void>(() => {}));
const setPromptAttachment = vi.fn();

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		ui: { setPromptAttachment },
		conversation: { sendPrompt },
	}),
	notify: vi.fn(),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import type { CanvasSelection } from "../src/canvas/DesignCanvas";
import { SelectionAskBadge } from "../src/canvas/SelectionAskBadge";
import { NotesStore } from "../src/notes/notes-store";
import type { VetdFrameEntry } from "../src/vetd/manifest-types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frames: VetdFrameEntry[] = [
	{ id: "login", title: "登录页", file: "frames/login.tsx", x: 100, y: 200, width: 390, height: 844 },
] as VetdFrameEntry[];

const selection: CanvasSelection = {
	kind: "dom",
	frameId: "login",
	payload: {
		tag: "button",
		domPath: "body>div>button",
		classes: "rounded",
		text: "登录",
		rect: { x: 20, y: 60, width: 100, height: 40 },
		source: "frames/login.tsx:42",
	},
};

const storeFs = {
	readFile: () => Promise.reject(new Error("ENOENT")),
	writeFile: () => Promise.resolve(),
} as unknown as PluginFsApi;

let host: HTMLDivElement;
let root: Root;
let store: NotesStore;
let submitted = 0;

beforeEach(async () => {
	vi.clearAllMocks();
	submitted = 0;
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	store = new NotesStore(storeFs, "/d/design.vetd.d");
	await store.load();
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function render({ blockedReason = null, open = true }: { blockedReason?: string | null; open?: boolean } = {}): void {
	act(() => {
		root.render(
			<SelectionAskBadge
				notes={store}
				selection={selection}
				frames={frames}
				visible
				blockedReason={blockedReason}
				open={open}
				onOpenChange={() => {}}
				onSubmitted={() => {
					submitted += 1;
				}}
			/>,
		);
	});
}

/** 在 popover 的输入框里打字并提交。 */
function type(text: string): void {
	const textarea = host.querySelector("textarea");
	if (!textarea) throw new Error("popover textarea not found");
	const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
	act(() => {
		setter?.call(textarea, text);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	});
	act(() => {
		host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	});
}

it("提交只落一条备注，自己不发消息也不挂附件", () => {
	render();
	type("把这个按钮改成圆角");

	// 派活统一交给 useNotesAutoDispatch，这里发消息就会与它重复。
	expect(sendPrompt).not.toHaveBeenCalled();
	expect(setPromptAttachment).not.toHaveBeenCalled();
	expect(submitted).toBe(1);

	expect(store.notes).toHaveLength(1);
	expect(store.notes[0].messages[0]).toMatchObject({ author: "user", text: "把这个按钮改成圆角" });
	// 锚在选框右上角，也就是徽标刚才所在的位置。
	expect(store.notes[0].anchor).toMatchObject({
		kind: "element",
		frameId: "login",
		fx: 120,
		fy: 60,
		element: { tag: "button", source: "frames/login.tsx:42" },
	});
});

it("提交后不抢派活器的活：新备注仍是未交付状态", () => {
	render();
	type("交给派活器");

	// 徽标若自己 markDispatched，自动派活器就再也不会把它交出去了。
	expect(store.isDispatched(store.notes[0])).toBe(false);
});

it("agent 忙的时候提交，落的还是同一种备注", () => {
	render({ blockedReason: "Vetta 正在忙" });
	type("等它闲下来再说");

	expect(sendPrompt).not.toHaveBeenCalled();
	expect(store.notes).toHaveLength(1);
	expect(store.notes[0].anchor.kind).toBe("element");
});

it("按钮文案在打开那一刻定下，agent 中途收工也不改口", () => {
	render({ blockedReason: "Vetta 正在忙" });
	expect(host.textContent).toContain("canvas.ask.badge.note");

	// agent 收工了，但 popover 已经开着，用户正照着「添加备注」在写。
	render({ blockedReason: null });
	expect(host.textContent).toContain("canvas.ask.note.submit");
});
