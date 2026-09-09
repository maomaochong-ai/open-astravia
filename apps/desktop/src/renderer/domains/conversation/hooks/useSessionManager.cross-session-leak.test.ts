// @vitest-environment jsdom

import type { ChatConversationItem, OpenSessionOptions, SessionExecutionMode } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { act, createElement, Fragment } from "react";
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
	prompt: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
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
vi.mock("@domains/plugins/runtime/plugin-host-bridge", () => ({ pluginSendMessageRef: { current: null } }));
vi.mock("@shared/i18n", () => ({ i18n: { t: (key: string) => key } }));
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
const sessionAPath = "C:\\sessions\\a.jsonl";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let rootLayoutManager: SessionManagerProbe | null = null;
let newSessionManager: SessionManagerProbe | null = null;

beforeEach(() => {
	installStorage();
	vi.resetModules();
	vi.clearAllMocks();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
});

afterEach(async () => {
	await act(async () => {
		await Promise.resolve();
		root?.unmount();
	});
	container?.remove();
	root = null;
	container = null;
	rootLayoutManager = null;
	newSessionManager = null;
	vi.unstubAllGlobals();
});

function toolPhases(messages: readonly ChatConversationItem[]): string[] {
	const phases: string[] = [];
	for (const message of messages) {
		if (message.kind !== "agent") continue;
		for (const block of message.blocks) {
			if (block.type === "tool_call" && block.currentPhase) phases.push(block.currentPhase);
		}
	}
	return phases;
}

it("会话 A 仍在流式输出时新建会话 B，A 的事件不得写进 B 的消息流", { timeout: 30_000 }, async () => {
	const { activeSessionAtom, chatMessagesAtom, inputValueAtom } = await import("@shared/store/atoms");
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	store.set(activeSessionAtom, null);
	store.set(chatMessagesAtom, []);
	store.set(inputValueAtom, "");

	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	const pumpFrames = () => {
		while (frames.length > 0) frames.shift()?.(0);
	};

	const handlers = new Map<string, (event: unknown) => void>();
	const sessionApi = {
		autoTitle: vi.fn(),
		create: vi.fn(async (config: { sessionPath?: string }) => ({
			cwd,
			sessionId: config.sessionPath === sessionAPath ? "runtime-a" : "runtime-b",
			sessionPath: config.sessionPath === sessionAPath ? sessionAPath : "C:\\sessions\\b.jsonl",
		})),
		getFullHistory: vi.fn(async () => []),
		openViewer: vi.fn(async () => ({ history: [] })),
		getQueueState: vi.fn(async () => ({ paused: false, entries: [] })),
		getSessionPath: vi.fn(async (sessionId: string) =>
			sessionId === "runtime-a" ? sessionAPath : "C:\\sessions\\b.jsonl",
		),
		getState: vi.fn(async (sessionId: string) => ({
			activeToolNames: [],
			contextPercent: null,
			contextWindow: 128_000,
			executionMode: "full-access" as const,
			isStreaming: sessionId === "runtime-a",
			messageCount: 0,
			model: null,
			scenario: "project" as const,
		})),
		prompt: mocks.prompt,
		subscribe: vi.fn(async (sessionId: string, handler: (event: unknown) => void) => {
			handlers.set(sessionId, handler);
			const unsubscribe = vi.fn(() => {
				if (handlers.get(sessionId) === handler) handlers.delete(sessionId);
			});
			return unsubscribe;
		}),
		updateSettings: vi.fn(async () => undefined),
	};
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			batchTasks: { resumeTaskWithText: vi.fn() },
			config: { get: vi.fn(async () => ({})) },
			dialog: { persistImages: vi.fn() },
			session: sessionApi,
		},
	});

	function RootLayoutProbe() {
		rootLayoutManager = useSessionManager();
		return null;
	}
	function NewSessionProbe() {
		newSessionManager = useSessionManager();
		return null;
	}

	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Fragment, null, createElement(RootLayoutProbe), createElement(NewSessionProbe)));
	});

	// 用户从侧边栏打开仍在跑的会话 A（RootLayout 实例持有它的订阅）。
	await act(async () => {
		await rootLayoutManager?.openSession(cwd, sessionAPath);
	});
	expect(handlers.has("runtime-a")).toBe(true);

	// 新会话页发起会话 B：create 暂不 resolve，停在「预处理等待」窗口内。
	let resolveCreate: (() => void) | undefined;
	sessionApi.create.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			resolveCreate = resolve;
		});
		return { cwd, sessionId: "runtime-b", sessionPath: "C:\\sessions\\b.jsonl" };
	});

	// 真实场景：navigateBeforeCreate 会 await 路由切换，这期间 A 仍处于订阅状态。
	mocks.navigate.mockImplementationOnce(async () => {
		handlers.get("runtime-a")?.({ type: "message.delta", delta: "A 的正文不该出现在 B" });
		handlers.get("runtime-a")?.({
			type: "tool.start",
			toolCallId: "call-nav",
			toolName: "write",
			args: {},
			startedAt: 1,
		});
		handlers.get("runtime-a")?.({ type: "tool.phase", toolCallId: "call-nav", label: "写入 during-nav.ts", atMs: 2 });
	});

	let opening: Promise<void> | undefined;
	await act(async () => {
		opening = newSessionManager?.openSession(cwd, undefined, "sandbox", {
			interactionId: "interaction-new-b",
			navigateBeforeCreate: true,
			preserveMessagesBeforeCreate: true,
		});
		await Promise.resolve();
		pumpFrames();
		await Promise.resolve();
		pumpFrames();
	});

	// 会话 A 继续输出：工具调用 + 阶段标签。只有仍然订阅着才会送达。
	const emitA = (event: unknown) => handlers.get("runtime-a")?.(event);
	await act(async () => {
		emitA({ type: "tool.start", toolCallId: "call-a", toolName: "write", args: {}, startedAt: 1 });
		emitA({ type: "tool.phase", toolCallId: "call-a", label: "写入 config.ts", atMs: 2 });
	});

	expect(toolPhases(store.get(chatMessagesAtom))).toEqual([]);

	// 已排期的 delta flush 属于「打开 A 的那个实例」，别的实例 resetEventBuffers
	// 拆不掉它；100ms 后触发时也不得补写进 B。
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150));
	});
	expect(
		store.get(chatMessagesAtom).some((message) => message.kind === "agent" && (message.text ?? "").length > 0),
	).toBe(false);

	resolveCreate?.();
	await act(async () => {
		pumpFrames();
		await opening;
	});
});
