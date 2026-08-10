/**
 * 追问徽标的接线：提交到底走了哪条路。
 *
 * 纯几何与去向判断在 selection-ask.test.ts 里；这里只盯住那些跨了边界、光看纯函数
 * 看不出来的事——附件挂没挂上、消息发没发（发了几次）、身份会不会被 streaming 中途
 * 掀翻、以及点开又关掉的截图有没有被删掉。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// 只换掉 useTranslation：definePluginPromptContext 留真的，附件才会真的过一遍
// schema 与体积校验。
vi.mock("@vetta-org/plugin-sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@vetta-org/plugin-sdk")>()),
	useTranslation: () => ({ t: (key: string) => key }),
}));

const setPromptAttachment = vi.fn();
const sendPrompt = vi.fn(() => new Promise<void>(() => {}));
const writeFile = vi.fn(() => Promise.resolve());
const deleteFile = vi.fn(() => Promise.resolve());

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		ui: { setPromptAttachment },
		conversation: { sendPrompt },
		fs: { writeFile, delete: deleteFile },
	}),
	notify: vi.fn(),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import type { CanvasSelection } from "../src/canvas/DesignCanvas";
import { SelectionAskBadge } from "../src/canvas/SelectionAskBadge";
import { NotesStore } from "../src/notes/notes-store";
import type { DesignSession } from "../src/vetd/design-session";
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

const session = { vetdPath: "/d/design.vetd", dirPath: "/d/design.vetd.d" } as DesignSession;

const storeFs = {
	readFile: () => Promise.reject(new Error("ENOENT")),
	writeFile: () => Promise.resolve(),
} as unknown as PluginFsApi;

let host: HTMLDivElement;
let root: Root;
let store: NotesStore;

beforeEach(async () => {
	vi.clearAllMocks();
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

interface RenderOptions {
	blockedReason?: string | null;
	open?: boolean;
	capture?: () => Promise<string>;
}

let submitted = 0;

function render({ blockedReason = null, open = true, capture }: RenderOptions = {}): void {
	act(() => {
		root.render(
			<SelectionAskBadge
				session={session}
				notes={store}
				selection={selection}
				frames={frames}
				visible
				blockedReason={blockedReason}
				capture={capture ?? (() => Promise.resolve("data:image/png;base64,AAAA"))}
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

/** 让挂起的截图 promise 链跑完。 */
async function settle(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
}

it("能发消息时：落一条备注，附件带着它的 id 先挂上，消息只发一次", async () => {
	render();
	await settle();
	submitted = 0;
	type("把这个按钮改成圆角");
	await settle();

	expect(sendPrompt).toHaveBeenCalledTimes(1);
	expect(sendPrompt).toHaveBeenCalledWith("把这个按钮改成圆角");
	expect(setPromptAttachment).toHaveBeenCalledTimes(1);
	// 宿主同步读附件，所以它必须在 sendPrompt 之前挂上。
	expect(setPromptAttachment.mock.invocationCallOrder[0]).toBeLessThan(sendPrompt.mock.invocationCallOrder[0]);

	// 追问同样落成画布备注，agent 的回复才有地方回来。
	expect(store.notes).toHaveLength(1);
	expect(store.notes[0].messages[0]).toMatchObject({ author: "user", text: "把这个按钮改成圆角" });

	const attachment = setPromptAttachment.mock.calls[0][0];
	// 一次性附件：sticky 会让这次选中黏在后面每一轮上。
	expect(attachment.lifecycle).toBeUndefined();
	const payload = attachment.context.payload;
	// agent 靠它认出「这条待处理备注就是我刚做完的这件事」，不会再做一遍。
	expect(payload.noteId).toBe(store.notes[0].id);
	expect(payload.selection.element).toMatchObject({ tag: "button", source: "frames/login.tsx:42" });
	expect(payload.selection.frames[0].screenshot).toMatch(/\.snapshots\/ask-login-\d+\.png$/);
	expect(submitted).toBe(1);
	// 发出去的截图必须留着——agent 随时会去 Read 那个路径。
	expect(deleteFile).not.toHaveBeenCalled();
});

it("发不了消息时：只落备注，一个字都不发给 agent", async () => {
	render({ blockedReason: "Vetta 正在忙" });
	await settle();
	submitted = 0;
	type("顺便把间距调大一点");
	await settle();

	expect(sendPrompt).not.toHaveBeenCalled();
	expect(setPromptAttachment).not.toHaveBeenCalled();
	// 备注不带截图：agent 读备注时 vetd_notes 会现截一张带编号标注的。
	expect(writeFile).not.toHaveBeenCalled();
	expect(submitted).toBe(1);

	expect(store.notes).toHaveLength(1);
	expect(store.notes[0].messages[0]).toMatchObject({ author: "user", text: "顺便把间距调大一点" });
	expect(store.notes[0].anchor).toMatchObject({
		kind: "element",
		frameId: "login",
		fx: 120,
		fy: 60,
		element: { tag: "button", source: "frames/login.tsx:42" },
	});
});

it("身份在打开那一刻冻结，agent 中途跑完也不会变成发送", async () => {
	render({ blockedReason: "Vetta 正在忙" });
	await settle();
	// agent 收工：闸口放行了，但 popover 已经开着，用户正照着「添加备注」在写。
	render({ blockedReason: null });
	await settle();
	submitted = 0;
	type("这里再紧凑些");
	await settle();

	expect(sendPrompt).not.toHaveBeenCalled();
	expect(store.notes).toHaveLength(1);
	expect(submitted).toBe(1);
});

it("点开又关掉的截图是孤儿，删掉", async () => {
	render();
	await settle();
	expect(writeFile).toHaveBeenCalledTimes(1);
	const path = writeFile.mock.calls[0][0];

	render({ open: false });
	await settle();

	expect(deleteFile).toHaveBeenCalledWith(path);
});
