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
	prompt: vi.fn(async (_sessionId: string, _request?: unknown) => undefined),
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
	sendMessage(overrideText?: string, options?: { source?: "plugin" }): Promise<unknown>;
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

const conversationCwd = "/workspace/conversation";
const conversationSessionPath = "/sessions/conversation.conversation.jsonl";
const petCwd = "/workspace/pet";
const petSessionPath = "/sessions/pet.conversation.jsonl";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const managers: SessionManagerProbe[] = [];

beforeEach(() => {
	installStorage();
	vi.resetModules();
	vi.clearAllMocks();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	managers.length = 0;
});

afterEach(async () => {
	await act(async () => {
		await Promise.resolve();
		root?.unmount();
	});
	container?.remove();
	root = null;
	container = null;
	vi.unstubAllGlobals();
});

it("陈旧实例的 sendMessage 仍应发给当前激活会话，而不是该实例最后打开的会话", async () => {
	// 复现事故形态：useSessionManager 在 RootLayout / ChatPage / NewSessionPage 同时挂载，
	// pluginSendMessageRef 只留最后渲染者的 sendMessage。若插件派活拿到的是「很久以前
	// 打开过另一个会话」的实例，消息必须仍落进 activeSessionAtom 指向的当前会话。
	const { activeSessionAtom, chatMessagesAtom } = await import("@shared/store/atoms");
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	store.set(activeSessionAtom, null);
	store.set(chatMessagesAtom, []);

	const sessionApi = {
		autoTitle: vi.fn(),
		create: vi.fn(async (config: { sessionPath?: string }) => ({
			cwd: config.sessionPath === conversationSessionPath ? conversationCwd : petCwd,
			sessionId: config.sessionPath === conversationSessionPath ? "runtime-conversation" : "runtime-pet",
			sessionPath: config.sessionPath ?? "",
		})),
		getFullHistory: vi.fn(async () => []),
		getQueueState: vi.fn(async () => ({ paused: false, entries: [] })),
		getSessionPath: vi.fn(async (sessionId: string) =>
			sessionId === "runtime-conversation" ? conversationSessionPath : petSessionPath,
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

	function Probe({ slot }: { slot: number }) {
		managers[slot] = useSessionManager();
		return null;
	}
	function Pair() {
		return [createElement(Probe, { key: "a", slot: 0 }), createElement(Probe, { key: "b", slot: 1 })];
	}

	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Pair));
	});
	expect(managers.length).toBe(2);
	const [staleInstance, freshInstance] = managers;

	// 实例 A 打开旧「对话」会话（其实例级 ref 从此指向 runtime-conversation）。
	await act(async () => {
		await staleInstance.openSession(conversationCwd, conversationSessionPath);
	});
	// 实例 B 打开 pet 会话 → activeSessionAtom 现在指向 runtime-pet。
	await act(async () => {
		await freshInstance.openSession(petCwd, petSessionPath);
	});
	expect(store.get(activeSessionAtom)?.runtimeId).toBe("runtime-pet");

	// 插件派活走的是实例 A 的 sendMessage（pluginSendMessageRef 的最后写入者是任意实例）。
	await act(async () => {
		await staleInstance.sendMessage("The user has pinned notes on the design canvas.", { source: "plugin" });
	});

	expect(mocks.prompt).toHaveBeenCalledTimes(1);
	expect(mocks.prompt.mock.calls[0][0]).toBe("runtime-pet");
});
