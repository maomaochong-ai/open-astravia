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
	openSession(cwd: string, sessionPath?: string): Promise<void>;
	sendMessage(): Promise<void>;
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

it("切回仍在执行的会话时保留尚未进入历史快照的乐观用户消息", async () => {
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

	let sendPromise: Promise<void> | undefined;
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

	pendingPrompt?.resolve(undefined);
	await sendPromise;
});
