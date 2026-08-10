/**
 * 备注自动派活：只要会话空闲，落下的备注就自己交给 agent。
 *
 * 盯住的是那些出错代价很高的路径——重复派活（同一件事发两遍）、以及 agent 漏
 * resolve 时的空转循环（无人看管时能烧掉很多 token）。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => `${key}:${JSON.stringify(vars ?? {})}` }),
}));

const sendPrompt = vi.fn(() => new Promise<void>(() => {}));
/** 插件订阅会话事件的那个回调，测试用它推 turn-start / turn-end。 */
let emit: ((event: unknown) => void) | null = null;

vi.mock("../src/plugin-context", () => ({
	getPluginCtx: () => ({
		conversation: {
			sendPrompt,
			on: (listener: (event: unknown) => void) => {
				emit = listener;
				return { dispose: () => {} };
			},
		},
	}),
	notify: vi.fn(),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import { useNotesAutoDispatch } from "../src/notes/handoff";
import { NotesStore } from "../src/notes/notes-store";
import type { NoteAnchor } from "../src/notes/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const anchor: NoteAnchor = { kind: "frame", frameId: "login", fx: 10, fy: 20 };

const fs = {
	readFile: () => Promise.reject(new Error("ENOENT")),
	writeFile: () => Promise.resolve(),
} as unknown as PluginFsApi;

let host: HTMLDivElement;
let root: Root;
let store: NotesStore;

function Harness({ cwd, tick }: { cwd: string | null; tick?: number }) {
	useNotesAutoDispatch(store, cwd);
	return <span>{tick}</span>;
}

/** 挂上派活器，并把会话推到「在这个 workspace、空闲」。 */
function mount(cwd: string | null = "/w"): void {
	act(() => {
		root.render(<Harness cwd={cwd} />);
	});
	act(() => {
		emit?.({ type: "conversation-changed", conversation: { cwd: "/w", isStreaming: false } });
	});
}

function streaming(on: boolean): void {
	act(() => {
		emit?.({ type: on ? "turn-start" : "turn-end" });
	});
}

/** 越过防抖窗口。 */
function elapse(): void {
	act(() => {
		vi.advanceTimersByTime(2_000);
	});
}

beforeEach(async () => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	emit = null;
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	store = new NotesStore(fs, "/w/design.vetd.d");
	await store.load();
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
	vi.useRealTimers();
});

it("打开设计稿时磁盘上躺着的存量备注不会凭空派出去", async () => {
	// 上次留下的一条待处理备注。
	const existing = {
		version: 1,
		notes: [{ id: "old", anchor, messages: [{ author: "user", text: "上次没做完的", at: 1 }], createdAt: 1 }],
	};
	const loaded = new NotesStore(
		{ readFile: () => Promise.resolve({ content: JSON.stringify(existing) }), writeFile: () => Promise.resolve() } as unknown as PluginFsApi,
		"/w/design.vetd.d",
	);
	await loaded.load();
	store = loaded;

	mount();
	elapse();
	// 打开画布不该凭空发起一轮工作 —— 要清存量还有面板上的手动按钮。
	expect(sendPrompt).not.toHaveBeenCalled();

	// 但重开它（追一条新消息）就是用户此刻的动作，照派。
	act(() => {
		store.appendMessage("old", "user", "这条还是得改");
	});
	elapse();
	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

it("空闲时落一条备注，自己就派出去了", () => {
	mount();
	act(() => {
		store.addNote(anchor, "把标题改大一点");
	});
	// 防抖窗口内不动手。
	expect(sendPrompt).not.toHaveBeenCalled();
	elapse();

	expect(sendPrompt).toHaveBeenCalledTimes(1);
	expect(sendPrompt.mock.calls[0][0]).toContain("pinned notes on the design canvas");
});

it("派活 prompt 不把 agent 的视野锁死在某一条上", () => {
	// 曾经单条派活会说「ids 传入该 id」，agent 就只查那一条、再不看别的，
	// 用户在它干活期间新贴的备注被整轮无视。派活一律让它列全量。
	mount();
	act(() => {
		store.addNote(anchor, "只有这一条");
	});
	elapse();

	const prompt = sendPrompt.mock.calls[0][0] as string;
	expect(prompt).toContain("no arguments");
	expect(prompt).not.toContain(store.notes[0].id);
	// 也要交代「做完一条还要看还剩什么」，不能做完就收工。
	expect(prompt).toContain("pendingRemaining");
});

it("防抖期间画布在不停重渲染，派活照样落地", () => {
	// 画布平移、缩放、热更新都会重渲染。派活如果依赖了每次渲染都新建的
	// sendAll/sendOne，计时器就会被一次次清掉重设，防抖永远等不到头。
	mount();
	act(() => {
		store.addNote(anchor, "别被重渲染吃掉");
	});
	// 一直渲染下去，中间不留任何安静的窗口：总时长远超防抖，派活必须已经发生。
	for (let i = 0; i < 15; i++) {
		act(() => {
			vi.advanceTimersByTime(200);
			root.render(<Harness cwd="/w" tick={i} />);
		});
	}

	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

it("连着放几条，合并成一次派活", () => {
	mount();
	act(() => {
		store.addNote(anchor, "第一条");
	});
	act(() => {
		vi.advanceTimersByTime(800);
		store.addNote(anchor, "第二条");
	});
	act(() => {
		vi.advanceTimersByTime(800);
		store.addNote(anchor, "第三条");
	});
	elapse();

	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

it("派活 prompt 不写死数量——用户随时还会再贴", () => {
	// 数量是发消息那一刻的快照。写死「3 条」等于给了 agent 一个做完就收工的借口，
	// 而这期间用户完全可能又贴了两条。只能让它实时查。
	mount();
	act(() => {
		store.addNote(anchor, "第一条");
		store.addNote(anchor, "第二条");
	});
	elapse();

	const prompt = sendPrompt.mock.calls[0][0] as string;
	expect(prompt).not.toMatch(/\d+\s*note/i);
	expect(prompt).toContain("pendingRemaining");
});

it("agent 正在跑时落的备注交给它自检，跑完也不补一条 prompt 去催", () => {
	mount();
	streaming(true);
	act(() => {
		store.addNote(anchor, "别打断它");
	});
	elapse();
	expect(sendPrompt).not.toHaveBeenCalled();

	// 这一轮结束。备注仍是待处理（agent 没 resolve），但不该冒出一条
	// 「还有 N 条待处理」的继续消息——它收尾自检时本就该自己捞走。
	streaming(false);
	elapse();
	expect(sendPrompt).not.toHaveBeenCalled();
});

it("没有可用会话时留着不动，会话就绪后才派", () => {
	// 会话在别的 workspace：没有人会来自检，所以不能记成已交付。
	mount("/other");
	act(() => {
		store.addNote(anchor, "等会话回来");
	});
	elapse();
	expect(sendPrompt).not.toHaveBeenCalled();

	act(() => {
		emit?.({ type: "conversation-changed", conversation: { cwd: "/other", isStreaming: false } });
	});
	elapse();
	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

it("agent 漏了 resolve 也不会一轮轮空转重派", () => {
	mount();
	act(() => {
		store.addNote(anchor, "做不了的一条");
	});
	elapse();
	expect(sendPrompt).toHaveBeenCalledTimes(1);

	// agent 跑完了却没 resolve：备注仍是待处理，但不该被反复推给它。
	streaming(true);
	streaming(false);
	elapse();
	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

it("重开备注是一件新的事，会重新派出去", () => {
	mount();
	act(() => {
		store.addNote(anchor, "第一次");
	});
	elapse();
	expect(sendPrompt).toHaveBeenCalledTimes(1);

	act(() => {
		store.appendMessage(store.notes[0].id, "user", "再改一下");
	});
	elapse();
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

it("已经亲手交出去的备注（徽标直发）不会被再派一次", () => {
	mount();
	act(() => {
		const note = store.addNote(anchor, "徽标里直接发的");
		store.markDispatched([note]);
	});
	elapse();

	expect(sendPrompt).not.toHaveBeenCalled();
});

it("agent 回复过的备注已经是已处理，不再派", () => {
	mount();
	act(() => {
		store.addNote(anchor, "改好了");
	});
	act(() => {
		store.appendMessage(store.notes[0].id, "agent", "已按要求调整");
	});
	elapse();

	expect(sendPrompt).not.toHaveBeenCalled();
});

it("会话不在这个 workspace 时不派", () => {
	mount("/other");
	act(() => {
		store.addNote(anchor, "不该发到别的工作区");
	});
	elapse();

	expect(sendPrompt).not.toHaveBeenCalled();
});
