// @vitest-environment jsdom

import { getDefaultStore } from "jotai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	applyLocalRename: vi.fn(),
	ensureLocalSession: vi.fn(),
	loadSessions: vi.fn(async () => undefined),
	navigate: vi.fn(async () => undefined),
	prompt: vi.fn(async (): Promise<unknown> => ({ status: "completed" })),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
}));

vi.mock("@domains/project/hooks/useProjects", () => ({
	useProjectActions: () => ({
		applyLocalRename: mocks.applyLocalRename,
		ensureLocalSession: mocks.ensureLocalSession,
		loadSessions: mocks.loadSessions,
	}),
}));

vi.mock("@domains/plugins/runtime/plugin-events", () => ({
	waitForPluginHostReady: async () => undefined,
}));

vi.mock("@domains/plugins/runtime/plugin-host-bridge", () => ({
	pluginSendMessageRef: { current: null },
}));

vi.mock("@shared/i18n", () => ({
	i18n: { t: (key: string) => key },
}));

vi.mock("@shared/lib/app-monitor-events", () => ({
	BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID: "builtin:knowledge-retrieval",
	recordInputActionsUsed: vi.fn(),
	recordInputContextUsed: vi.fn(),
}));

vi.mock("../services/context-composition-cache", () => ({
	resolveSessionContextComposition: () => undefined,
	writeCachedContextComposition: vi.fn(),
}));

interface SessionManagerProbe {
	sendMessage(): Promise<{ status: "sent" | "queued"; queueItemId?: string } | undefined>;
	openSession(cwd: string, sessionPath?: string): Promise<void>;
	sendQueuedNow(runtimeId: string, id: string): Promise<void>;
}

type SessionEventHandler = (event: unknown) => void;

function installStorage(): void {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		removeItem: (key: string) => void values.delete(key),
		setItem: (key: string, value: string) => void values.set(key, value),
	});
}

const cwd = "/workspace";
const sessionPath = "/sessions/first.conversation.jsonl";
const runtimeId = "runtime-queue";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let manager: SessionManagerProbe | null = null;

beforeEach(() => {
	installStorage();
	vi.resetModules();
	vi.clearAllMocks();
	mocks.prompt.mockImplementation(async () => ({ status: "completed" }));
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			batchTasks: { resumeTaskWithText: vi.fn() },
			config: { get: vi.fn() },
			dialog: { persistImages: vi.fn(async () => []) },
			session: {
				autoTitle: vi.fn(),
				getFullHistory: vi.fn(async () => []),
				getQueueState: vi.fn(async () => ({ paused: false, entries: [] })),
				prompt: mocks.prompt,
				replaceLastUserMessage: vi.fn(async () => ({ leafId: null })),
				subscribe: vi.fn(async () => vi.fn()),
			},
		},
	});
});

afterEach(async () => {
	await act(async () => {
		await Promise.resolve();
		root?.unmount();
	});
	container?.remove();
	root = null;
	container = null;
	manager = null;
	vi.unstubAllGlobals();
});

async function mount(input: string, streaming: boolean): Promise<ReturnType<typeof getDefaultStore>> {
	const { activeSessionAtom, activeSessionStreamingAtom, chatMessagesAtom, inputValueAtom } = await import(
		"@shared/store/atoms"
	);
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	store.set(activeSessionAtom, { cwd, runtimeId, sessionPath });
	store.set(chatMessagesAtom, []);
	store.set(inputValueAtom, input);
	store.set(activeSessionStreamingAtom, streaming);

	function Probe() {
		manager = useSessionManager();
		return null;
	}
	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Probe));
	});
	return store;
}

it("streaming 中发送：带 streamingBehavior=followUp 直发 kernel，收 queued 回执且不加乐观气泡", async () => {
	mocks.prompt.mockImplementation(async () => ({ status: "queued", pendingCount: 1, queueItemId: "q-1" }));
	const store = await mount("排队消息", true);
	const { chatMessagesAtom, inputValueAtom } = await import("@shared/store/atoms");

	let result: Awaited<ReturnType<SessionManagerProbe["sendMessage"]>>;
	await act(async () => {
		result = await manager?.sendMessage();
	});

	expect(mocks.prompt).toHaveBeenCalledTimes(1);
	const [, request] = mocks.prompt.mock.calls[0] as unknown as [string, { text: string; streamingBehavior?: string }];
	expect(request.streamingBehavior).toBe("followUp");
	expect(request.text).toBe("排队消息");
	expect(result).toEqual({ status: "queued", queueItemId: "q-1" });
	// 排队消息不上屏：待消费时经 queue.changed 差分补气泡，顺序与模型可见一致。
	expect(store.get(chatMessagesAtom)).toEqual([]);
	// 入队语义下输入框仍然清空。
	expect(store.get(inputValueAtom)).toBe("");
});

it("失步竞态：以为空闲实则已在跑（回执 queued）时撤掉抢先的乐观气泡", async () => {
	mocks.prompt.mockImplementation(async () => ({ status: "queued", pendingCount: 1, queueItemId: "q-2" }));
	const store = await mount("竞态消息", false);
	const { chatMessagesAtom } = await import("@shared/store/atoms");

	await act(async () => {
		await manager?.sendMessage();
	});

	expect(store.get(chatMessagesAtom).filter((m) => m.role === "user")).toEqual([]);
});

it("turn 内接力消费：第二条回复的流式内容开新气泡、排在补出的用户气泡之后", async () => {
	let eventHandler: SessionEventHandler | undefined;
	const sessionApi = (window as unknown as { vetta: { session: Record<string, unknown> } }).vetta.session;
	sessionApi.create = vi.fn(async () => ({ cwd, sessionId: runtimeId, sessionPath }));
	sessionApi.getSessionPath = vi.fn(async () => sessionPath);
	sessionApi.getState = vi.fn(async () => ({
		activeToolNames: [],
		contextPercent: null,
		contextWindow: 128_000,
		executionMode: "full-access",
		isStreaming: true,
		messageCount: 0,
		model: null,
		scenario: "project",
	}));
	sessionApi.subscribe = vi.fn(async (_sessionId: string, handler: SessionEventHandler) => {
		eventHandler = handler;
		return vi.fn();
	});
	const store = await mount("", false);
	const { chatMessagesAtom } = await import("@shared/store/atoms");
	await act(async () => {
		await manager?.openSession(cwd, sessionPath);
	});
	if (!eventHandler) throw new Error("subscribe handler not captured");
	const emit = (event: unknown): void => {
		act(() => eventHandler?.(event));
	};
	const base = { schemaVersion: 1, sessionId: runtimeId, eventId: "e", timestamp: Date.now(), source: "runtime-core" };

	emit({ ...base, type: "session.lifecycle", phase: "agent_start" });
	emit({ ...base, type: "message.delta", delta: "回答一" });
	// 入队（第二条消息进入 kernel 队列）→ 随后被本轮自然停止点消费。
	emit({
		...base,
		type: "queue.changed",
		paused: false,
		entries: [{ id: "q-2", behavior: "followUp", displayText: "第二条消息" }],
		snapshot: {},
	});
	emit({ ...base, type: "queue.changed", paused: false, entries: [], snapshot: {} });
	emit({ ...base, type: "message.delta", delta: "回答二" });
	// delta 按 100ms 批量落地。
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150));
	});

	const shape = store
		.get(chatMessagesAtom)
		.filter((m) => m.text.length > 0)
		.map((m) => [m.role, m.text]);
	expect(shape).toEqual([
		["assistant", "回答一"],
		["user", "第二条消息"],
		["assistant", "回答二"],
	]);
});

it("立即发送打断插队：上一回合已 streaming 的部分回复保留，不被吞掉", async () => {
	let eventHandler: SessionEventHandler | undefined;
	const sessionApi = (window as unknown as { vetta: { session: Record<string, unknown> } }).vetta.session;
	sessionApi.create = vi.fn(async () => ({ cwd, sessionId: runtimeId, sessionPath }));
	sessionApi.getSessionPath = vi.fn(async () => sessionPath);
	sessionApi.getState = vi.fn(async () => ({
		activeToolNames: [],
		contextPercent: null,
		contextWindow: 128_000,
		executionMode: "full-access",
		isStreaming: true,
		messageCount: 0,
		model: null,
		scenario: "project",
	}));
	sessionApi.subscribe = vi.fn(async (_sessionId: string, handler: SessionEventHandler) => {
		eventHandler = handler;
		return vi.fn();
	});
	sessionApi.sendQueuedMessageNow = vi.fn(async () => "started");
	// 历史随流程推进：打开会话时只有第一条用户消息；新回合结束后才是完整 canonical
	// （U1、被打断的部分回复 stopReason=aborted、U2、回复二）。
	const historyRef: { current: unknown[] } = {
		current: [{ type: "message", entryId: "e-u1", message: { role: "user", content: "第一条" } }],
	};
	sessionApi.getFullHistory = vi.fn(async () => historyRef.current);
	const canonicalAfterInterrupt = [
		{ type: "message", entryId: "e-u1", message: { role: "user", content: "第一条" } },
		{
			type: "message",
			entryId: "e-a1",
			message: { role: "assistant", content: [{ type: "text", text: "部分回复" }], stopReason: "aborted" },
		},
		{ type: "message", entryId: "e-u2", message: { role: "user", content: "插队消息" } },
		{
			type: "message",
			entryId: "e-a2",
			message: { role: "assistant", content: [{ type: "text", text: "回复二" }], stopReason: "end_turn" },
		},
	];
	const store = await mount("", false);
	const { chatMessagesAtom } = await import("@shared/store/atoms");
	await act(async () => {
		await manager?.openSession(cwd, sessionPath);
	});
	if (!eventHandler) throw new Error("subscribe handler not captured");
	const emit = (event: unknown): void => {
		act(() => eventHandler?.(event));
	};
	const base = { schemaVersion: 1, sessionId: runtimeId, eventId: "e", timestamp: Date.now(), source: "runtime-core" };
	const flushTimers = async (): Promise<void> => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});
	};

	// 旧回合：用户消息 + 部分回复 streaming 中，第二条消息已入队。
	emit({ ...base, type: "session.lifecycle", phase: "agent_start" });
	emit({ ...base, type: "message.delta", delta: "部分回复" });
	await flushTimers();
	emit({
		...base,
		type: "queue.changed",
		paused: false,
		entries: [{ id: "q-2", behavior: "followUp", displayText: "插队消息" }],
		snapshot: {},
	});

	// 用户点「立即发送」：kernel 原子地 take → cancel → start。渲染端先 bump 序号，
	// 随后事件依序回流：消费（条目消失）→ aborted 部分回复 final → 旧回合收尾 → 新回合。
	await act(async () => {
		await manager?.sendQueuedNow(runtimeId, "q-2");
	});
	emit({ ...base, type: "queue.changed", paused: false, entries: [], snapshot: {} });
	emit({
		...base,
		type: "message.final",
		message: { role: "assistant", content: [{ type: "text", text: "部分回复" }], stopReason: "aborted" },
	});
	emit({ ...base, type: "session.lifecycle", phase: "aborted" });
	emit({ ...base, type: "session.lifecycle", phase: "agent_end" });
	emit({ ...base, type: "session.lifecycle", phase: "agent_start" });
	emit({ ...base, type: "message.delta", delta: "回复二" });
	await flushTimers();
	emit({
		...base,
		type: "message.final",
		message: { role: "assistant", content: [{ type: "text", text: "回复二" }], stopReason: "end_turn" },
	});
	historyRef.current = canonicalAfterInterrupt;
	emit({ ...base, type: "session.lifecycle", phase: "agent_end" });
	// 等 canonical 重拉落地。
	await flushTimers();

	const shape = store
		.get(chatMessagesAtom)
		.filter((m) => m.text.length > 0)
		.map((m) => [m.role, m.text]);
	// 中途快照与 canonical 落地后都必须保留「部分回复」，且顺序正确。
	expect(shape).toEqual([
		["user", "第一条"],
		["assistant", "部分回复"],
		["user", "插队消息"],
		["assistant", "回复二"],
	]);
});

it("空闲发送：正常上屏乐观气泡并返回 sent", async () => {
	const store = await mount("普通消息", false);
	const { chatMessagesAtom } = await import("@shared/store/atoms");

	let result: Awaited<ReturnType<SessionManagerProbe["sendMessage"]>>;
	await act(async () => {
		result = await manager?.sendMessage();
	});

	expect(result).toEqual({ status: "sent" });
	expect(store.get(chatMessagesAtom).map((m) => m.text)).toContain("普通消息");
});
