// @vitest-environment jsdom

import type { OpenSessionOptions } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withSessionAttach } from "./session-attach.fixture";

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

vi.mock("../services/context-composition-cache", () => ({
	resolveSessionContextComposition: () => undefined,
	writeCachedContextComposition: vi.fn(),
}));

interface SessionManagerProbe {
	sendMessage(
		overrideText?: string,
		options?: { stagedInput?: import("@shared/store/atoms").StagedSendInput },
	): Promise<unknown>;
	openSession(cwd: string, sessionPath?: string, executionMode?: string, options?: OpenSessionOptions): Promise<void>;
}

const cwd = "/workspace";
const sessionPath = "/sessions/pending-edit.conversation.jsonl";
const runtimeId = "runtime-pending-edit";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let manager: SessionManagerProbe | null = null;

function installStorage(): void {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		clear: () => values.clear(),
		getItem: (key: string) => values.get(key) ?? null,
		removeItem: (key: string) => void values.delete(key),
		setItem: (key: string, value: string) => void values.set(key, value),
	});
}

let sessionApi: Record<string, unknown>;

beforeEach(() => {
	installStorage();
	vi.resetModules();
	vi.clearAllMocks();
	mocks.prompt.mockImplementation(async () => ({ status: "completed" }));
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	sessionApi = withSessionAttach({
		autoTitle: vi.fn(),
		getFullHistory: vi.fn(async () => []),
		getQueueState: vi.fn(async () => ({ paused: false, entries: [] })),
		getSessionPath: vi.fn(async () => sessionPath),
		getState: vi.fn(async () => ({
			activeToolNames: [],
			contextPercent: null,
			contextWindow: 128_000,
			executionMode: "sandbox",
			isStreaming: false,
			messageCount: 1,
			model: null,
			scenario: "project",
		})),
		prompt: mocks.prompt,
		replaceLastUserMessage: vi.fn(async () => ({ leafId: null })),
		subscribe: vi.fn(async () => vi.fn()),
		updateSettings: vi.fn(async () => undefined),
	}) as Record<string, unknown>;
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			batchTasks: { resumeTaskWithText: vi.fn() },
			config: { get: vi.fn(async () => ({})) },
			dialog: { persistImages: vi.fn(async () => []) },
			session: sessionApi,
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

/** 挂载 useSessionManager，并放进一条「已经在对话里」的用户消息。 */
async function mountConversation(input: string) {
	const { activeSessionAtom, activeSessionStreamingAtom, chatMessagesAtom, inputValueAtom } = await import(
		"@shared/store/atoms"
	);
	const { useSessionManager } = await import("./useSessionManager");
	const store = getDefaultStore();
	store.set(activeSessionAtom, { cwd, runtimeId, sessionPath });
	store.set(chatMessagesAtom, [
		{
			kind: "user",
			id: "local-user-1",
			entryId: "entry-u1",
			deliveryPhase: "completed",
			text: "上一条问题",
			timestamp: Date.now() - 1000,
		},
		{ kind: "agent", id: "local-agent-1", text: "上一条回复", blocks: [], timestamp: Date.now() - 500 },
	] as never);
	store.set(inputValueAtom, input);
	store.set(activeSessionStreamingAtom, false);

	function Probe() {
		manager = useSessionManager() as unknown as SessionManagerProbe;
		return null;
	}
	await act(async () => {
		root = createRoot(container as HTMLDivElement);
		root.render(createElement(Probe));
	});
	return store;
}

it("陈旧的编辑态不会替换上一条消息，而是按普通消息发送", { timeout: 30_000 }, async () => {
	const store = await mountConversation("这条要作为新消息发出");
	const { pendingMessageEditAtom } = await import("@shared/store/atoms");

	// 模拟「编辑态残留」：entryId 指向另一条消息（例如切会话前编辑过、或原消息已被替换）。
	store.set(pendingMessageEditAtom, { entryId: "entry-from-another-session" });
	const replaceLastUserMessage = sessionApi.replaceLastUserMessage as ReturnType<typeof vi.fn>;
	replaceLastUserMessage.mockImplementation(async () => {
		throw new Error("entry not found");
	});

	await act(async () => {
		await manager?.sendMessage();
	});

	// 用户意图是「发一条新消息」：不能去替换上一条，也不能因为替换失败把消息吞掉。
	expect(replaceLastUserMessage).not.toHaveBeenCalled();
	expect(mocks.prompt).toHaveBeenCalledTimes(1);
	expect(store.get(pendingMessageEditAtom)).toBeNull();
});

it("编辑态指向当前最后一条用户消息时，仍然替换而不是追加", { timeout: 30_000 }, async () => {
	const store = await mountConversation("改写后的问题");
	const { pendingMessageEditAtom } = await import("@shared/store/atoms");

	store.set(pendingMessageEditAtom, { entryId: "entry-u1" });
	const replaceLastUserMessage = sessionApi.replaceLastUserMessage as ReturnType<typeof vi.fn>;

	await act(async () => {
		await manager?.sendMessage();
	});

	expect(replaceLastUserMessage).toHaveBeenCalledWith(runtimeId, "entry-u1");
	expect(mocks.prompt).toHaveBeenCalledTimes(1);
	expect(store.get(pendingMessageEditAtom)).toBeNull();
});

it("替换失败时结束编辑态并把文字退回输入框，不再吞掉后续发送", { timeout: 30_000 }, async () => {
	const store = await mountConversation("要保留的文字");
	const { inputValueAtom, pendingMessageEditAtom } = await import("@shared/store/atoms");

	store.set(pendingMessageEditAtom, { entryId: "entry-u1" });
	const replaceLastUserMessage = sessionApi.replaceLastUserMessage as ReturnType<typeof vi.fn>;
	replaceLastUserMessage.mockImplementation(async () => {
		throw new Error("runtime busy");
	});

	await act(async () => {
		await manager?.sendMessage();
	});

	// 编辑态必须结束：否则下一次发送会继续撞同一条替换，新内容永远发不出去。
	expect(store.get(pendingMessageEditAtom)).toBeNull();
	expect(store.get(inputValueAtom)).toBe("要保留的文字");
	expect(mocks.prompt).not.toHaveBeenCalled();
});
