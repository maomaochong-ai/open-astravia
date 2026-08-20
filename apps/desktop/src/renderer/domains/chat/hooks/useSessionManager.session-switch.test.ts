// @vitest-environment jsdom

import type { OpenSessionOptions, SessionExecutionMode } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	applyLocalRename: vi.fn(),
	ensureLocalSession: vi.fn(),
	loadSessions: vi.fn(async () => undefined),
	navigate: vi.fn(async () => undefined),
	perfSessionSwitchBegin: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
	perfSessionSwitchComplete: vi.fn(),
	perfSessionSwitchMark: vi.fn(),
	prompt: vi.fn(),
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
	waitForPluginHostFirstReady: async () => undefined,
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

vi.mock("@shared/lib/perf-session-switch", () => ({
	perfSessionSwitchBegin: mocks.perfSessionSwitchBegin,
	perfSessionSwitchComplete: mocks.perfSessionSwitchComplete,
	perfSessionSwitchMark: mocks.perfSessionSwitchMark,
}));

vi.mock("../services/context-composition-cache", () => ({
	resolveSessionContextComposition: () => undefined,
	writeCachedContextComposition: vi.fn(),
}));

interface SessionManagerProbe {
	openSession(
		cwd: string,
		sessionPath?: string,
		executionMode?: SessionExecutionMode,
		options?: OpenSessionOptions,
	): Promise<void>;
	sendMessage(): Promise<unknown>;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve(value) {
			resolvePromise?.(value);
		},
	};
}

function installStorage(): void {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		removeItem: (key: string) => void values.delete(key),
		setItem: (key: string, value: string) => void values.set(key, value),
	});
}

const cwd = "C:\\workspace";
const firstSessionPath = "C:\\sessions\\first.jsonl";
const firstCanonicalPath = "C:\\sessions\\first.conversation.jsonl";
const secondSessionPath = "C:\\sessions\\second.jsonl";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let manager: SessionManagerProbe | null = null;
let pendingPrompt: Deferred<void> | null = null;

beforeEach(() => {
	installStorage();
	vi.resetModules();
	vi.clearAllMocks();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	pendingPrompt = deferred<void>();
	mocks.prompt.mockImplementation(() => pendingPrompt?.promise ?? Promise.resolve());
});

afterEach(async () => {
	pendingPrompt?.resolve(undefined);
	await act(async () => {
		await Promise.resolve();
		root?.unmount();
	});
	container?.remove();
	root = null;
	container = null;
	manager = null;
	pendingPrompt = null;
	vi.unstubAllGlobals();
});

it("切回仍在执行的会话时保留尚未进入历史快照的乐观用户消息", { timeout: 10_000 }, async () => {
	const { activeSessionAtom, chatMessagesAtom, inputValueAtom } = await import("@shared/store/atoms");
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	store.set(activeSessionAtom, {
		cwd,
		runtimeId: "runtime-first",
		sessionPath: firstSessionPath,
	});
	store.set(chatMessagesAtom, []);
	store.set(inputValueAtom, "keep this user message");

	const getFullHistory = vi.fn(async () => []);
	const sessionApi = {
		autoTitle: vi.fn(),
		create: vi.fn(async (config: { sessionPath?: string }) => ({
			cwd,
			sessionId: config.sessionPath === firstSessionPath ? "runtime-first" : "runtime-second",
			sessionPath: config.sessionPath === firstSessionPath ? firstCanonicalPath : secondSessionPath,
		})),
		getFullHistory,
		getQueueState: vi.fn(async () => ({ paused: false, entries: [] })),
		getSessionPath: vi.fn(async (sessionId: string) =>
			sessionId === "runtime-first" ? firstSessionPath : secondSessionPath,
		),
		getState: vi.fn(async (sessionId: string) => ({
			activeToolNames: [],
			contextPercent: null,
			contextWindow: 128_000,
			executionMode: "full-access" as const,
			isStreaming: sessionId === "runtime-first",
			messageCount: 0,
			model: null,
			scenario: "project" as const,
		})),
		prompt: mocks.prompt,
		subscribe: vi.fn(async () => vi.fn()),
		updateSettings: vi.fn(async () => undefined),
	};
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			batchTasks: { resumeTaskWithText: vi.fn() },
			config: { get: vi.fn() },
			dialog: { persistImages: vi.fn() },
			session: sessionApi,
		},
	});

	function Probe() {
		manager = useSessionManager();
		return null;
	}

	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Probe));
	});

	let sendPromise: Promise<unknown> | undefined;
	await act(async () => {
		sendPromise = manager?.sendMessage();
		await Promise.resolve();
	});
	expect(mocks.prompt).toHaveBeenCalledTimes(1);
	expect(store.get(chatMessagesAtom).map((message) => message.text)).toContain("keep this user message");

	await act(async () => {
		await manager?.openSession(cwd, secondSessionPath);
		await manager?.openSession(cwd, firstSessionPath);
	});

	// canonical 历史仍为空，但按 runtimeId 保存的待确认气泡必须跨过会话水合继续显示。
	expect(store.get(chatMessagesAtom).map((message) => message.text)).toContain("keep this user message");
	expect(store.get(activeSessionAtom)?.sessionPath).toBe(firstCanonicalPath);
	expect(mocks.perfSessionSwitchBegin).toHaveBeenCalledTimes(2);
	expect(sessionApi.create).toHaveBeenNthCalledWith(
		1,
		expect.objectContaining({ sessionPath: secondSessionPath }),
		"conversation",
		{ interactionId: "00000000-0000-4000-8000-000000000001" },
	);
	expect(sessionApi.create).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining({ sessionPath: firstSessionPath }),
		"conversation",
		{ interactionId: "00000000-0000-4000-8000-000000000001" },
	);
	expect(mocks.perfSessionSwitchComplete).toHaveBeenCalledWith("completed", "00000000-0000-4000-8000-000000000001");

	pendingPrompt?.resolve(undefined);
	await sendPromise;
});

it("新会话先导航并完成一帧绘制，再创建 runtime，同时保留暂存消息", { timeout: 10_000 }, async () => {
	const { activeSessionAtom, chatMessagesAtom, pendingSessionCreationAtom } = await import("@shared/store/atoms");
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	const onPromptReady = vi.fn();
	const sessionApi = {
		autoTitle: vi.fn(),
		create: vi.fn(async () => ({
			cwd,
			sessionId: "runtime-new",
			sessionPath: firstCanonicalPath,
		})),
		getFullHistory: vi.fn(async () => []),
		getQueueState: vi.fn(async () => ({ paused: false, entries: [] })),
		getSessionPath: vi.fn(async () => firstCanonicalPath),
		getState: vi.fn(async () => ({
			activeToolNames: [],
			contextPercent: null,
			contextWindow: 128_000,
			executionMode: "sandbox" as const,
			isStreaming: false,
			messageCount: 0,
			model: null,
			scenario: "project" as const,
		})),
		prompt: vi.fn(),
		subscribe: vi.fn(async () => vi.fn()),
		updateSettings: vi.fn(async () => undefined),
	};
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			batchTasks: { resumeTaskWithText: vi.fn() },
			config: { get: vi.fn() },
			dialog: { persistImages: vi.fn() },
			session: sessionApi,
		},
	});
	store.set(activeSessionAtom, null);
	store.set(chatMessagesAtom, [{ id: "staged-user", role: "user", text: "hello" }]);

	function Probe() {
		manager = useSessionManager();
		return null;
	}

	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Probe));
	});

	let opening: Promise<void> | undefined;
	await act(async () => {
		opening = manager?.openSession(cwd, undefined, "sandbox", {
			navigateBeforeCreate: true,
			preserveMessagesBeforeCreate: true,
			onPromptReady,
			interactionId: "interaction-new",
		});
		await Promise.resolve();
	});

	expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" });
	expect(sessionApi.create).not.toHaveBeenCalled();
	expect(store.get(pendingSessionCreationAtom)).toEqual({ cwd, interactionId: "interaction-new" });
	expect(store.get(chatMessagesAtom)).toEqual([{ id: "staged-user", role: "user", text: "hello" }]);

	await act(async () => {
		frames.shift()?.(0);
		frames.shift()?.(16);
		await opening;
	});

	expect(sessionApi.create).toHaveBeenCalledOnce();
	expect(onPromptReady).toHaveBeenCalledOnce();
	expect(store.get(pendingSessionCreationAtom)).toBeNull();
	expect(store.get(activeSessionAtom)?.runtimeId).toBe("runtime-new");
	expect(store.get(chatMessagesAtom)).toEqual([{ id: "staged-user", role: "user", text: "hello" }]);
});

it("已有会话先提交加载态，快速切换时只有最后一次打开可以提交", { timeout: 10_000 }, async () => {
	const { activeSessionAtom, chatMessagesAtom, pendingSessionOpenAtom } = await import("@shared/store/atoms");
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	const firstCreate = deferred<{ cwd: string; sessionId: string; sessionPath: string }>();
	const secondCreate = deferred<{ cwd: string; sessionId: string; sessionPath: string }>();
	const sessionApi = {
		autoTitle: vi.fn(),
		create: vi.fn((config: { sessionPath?: string }) =>
			config.sessionPath === firstSessionPath ? firstCreate.promise : secondCreate.promise,
		),
		getFullHistory: vi.fn(async () => []),
		getQueueState: vi.fn(async () => ({ paused: false, entries: [] })),
		getSessionPath: vi.fn(async (sessionId: string) =>
			sessionId === "runtime-first" ? firstCanonicalPath : secondSessionPath,
		),
		getState: vi.fn(async () => ({
			activeToolNames: [],
			contextPercent: null,
			contextWindow: 128_000,
			executionMode: "full-access" as const,
			isStreaming: false,
			messageCount: 0,
			model: null,
			scenario: "project" as const,
		})),
		prompt: vi.fn(),
		subscribe: vi.fn(async () => vi.fn()),
		updateSettings: vi.fn(async () => undefined),
	};
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			batchTasks: { resumeTaskWithText: vi.fn() },
			config: { get: vi.fn() },
			dialog: { persistImages: vi.fn() },
			session: sessionApi,
		},
	});
	store.set(activeSessionAtom, { cwd, runtimeId: "runtime-current", sessionPath: "C:\\sessions\\current.jsonl" });
	store.set(chatMessagesAtom, [{ id: "old", role: "user", text: "old session" }]);

	function Probe() {
		manager = useSessionManager();
		return null;
	}

	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Probe));
	});

	let firstOpening: Promise<void> | undefined;
	await act(async () => {
		firstOpening = manager?.openSession(cwd, firstSessionPath, undefined, { interactionId: "open-first" });
		await Promise.resolve();
		await Promise.resolve();
	});

	expect(store.get(pendingSessionOpenAtom)).toEqual({
		cwd,
		interactionId: "open-first",
		sessionPath: firstSessionPath,
	});
	expect(store.get(activeSessionAtom)).toBeNull();
	expect(store.get(chatMessagesAtom)).toEqual([]);
	expect(sessionApi.create).toHaveBeenCalledTimes(1);

	let secondOpening: Promise<void> | undefined;
	await act(async () => {
		secondOpening = manager?.openSession(cwd, secondSessionPath, undefined, { interactionId: "open-second" });
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(store.get(pendingSessionOpenAtom)?.interactionId).toBe("open-second");

	await act(async () => {
		secondCreate.resolve({ cwd, sessionId: "runtime-second", sessionPath: secondSessionPath });
		await secondOpening;
	});
	expect(store.get(activeSessionAtom)?.runtimeId).toBe("runtime-second");
	expect(store.get(pendingSessionOpenAtom)).toBeNull();

	await act(async () => {
		firstCreate.resolve({ cwd, sessionId: "runtime-first", sessionPath: firstCanonicalPath });
		await firstOpening;
	});

	expect(store.get(activeSessionAtom)?.runtimeId).toBe("runtime-second");
	expect(mocks.perfSessionSwitchComplete).toHaveBeenCalledWith("cancelled", "open-first");
	expect(mocks.perfSessionSwitchComplete).toHaveBeenCalledWith("completed", "open-second");
});

it("已有会话创建失败时退出加载态并保留可诊断错误", { timeout: 10_000 }, async () => {
	const { activeSessionAtom, chatMessagesAtom, pendingSessionOpenAtom } = await import("@shared/store/atoms");
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	const failure = new Error("restore failed");
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			batchTasks: { resumeTaskWithText: vi.fn() },
			config: { get: vi.fn() },
			dialog: { persistImages: vi.fn() },
			session: {
				autoTitle: vi.fn(),
				create: vi.fn(async () => Promise.reject(failure)),
				prompt: vi.fn(),
			},
		},
	});
	store.set(activeSessionAtom, { cwd, runtimeId: "runtime-current", sessionPath: firstSessionPath });
	store.set(chatMessagesAtom, []);

	function Probe() {
		manager = useSessionManager();
		return null;
	}

	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Probe));
	});
	await act(async () => {
		await manager?.openSession(cwd, secondSessionPath, undefined, { interactionId: "open-failed" });
	});

	expect(store.get(pendingSessionOpenAtom)).toBeNull();
	expect(store.get(activeSessionAtom)).toBeNull();
	expect(store.get(chatMessagesAtom).at(-1)?.blocks?.at(-1)).toMatchObject({ type: "error", text: failure.message });
	expect(mocks.perfSessionSwitchComplete).toHaveBeenCalledWith("failed", "open-failed");
});
