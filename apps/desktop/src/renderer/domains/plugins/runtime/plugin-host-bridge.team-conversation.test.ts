import type { ConversationEvent } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const RUNTIME_STATE_KEY = "__vettaPluginHostBridgeRuntimeState_v2";

// 事件桥读的是 jotai 默认 store，测试要用同一批 atom 实例才写得进去。
const atoms = await vi.hoisted(async () => {
	const { atom } = await import("jotai");
	return {
		activeSessionAtom: atom<{ runtimeId: string; cwd: string; sessionPath: string } | null>(null),
		chatMessagesAtom: atom([]),
		inputValueAtom: atom(""),
		isStreamingAtom: atom(false),
		languageAtom: atom("zh"),
		openSessionFnRef: { current: null },
		pluginConversationOverrideAtom: atom<{ id: string | null; cwd: string | null } | null>(null),
		promptAttachmentAtom: atom(null),
		selectedModelAtom: atom(null),
		sessionExecutionModeAtom: atom("workspace-write"),
	};
});

vi.mock("@shared/store/atoms", () => atoms);

beforeEach(() => {
	vi.resetModules();
	delete (globalThis as unknown as Record<string, unknown>)[RUNTIME_STATE_KEY];
	vi.stubGlobal("window", {
		vetta: {
			plugins: {
				onAgentToolRequest: () => () => undefined,
				onAgentHookRequest: () => () => undefined,
				onAgentHandlerReleased: () => () => undefined,
				onAppActionRequest: () => () => undefined,
				onAppActionCancel: () => () => undefined,
				onContinuationRequest: () => () => undefined,
				onSystemPromptRequest: () => () => undefined,
				onMediaProviderRequest: () => () => undefined,
				onOcrProviderRequest: () => () => undefined,
				onOcrProviderCancel: () => () => undefined,
			},
			session: { subscribe: async () => () => undefined },
		},
	});
});

describe("plugin conversation bridge: team sessions", () => {
	it("publishes the team workspace as the current conversation", async () => {
		const { getDefaultStore } = await import("jotai");
		const store = getDefaultStore();
		store.set(atoms.pluginConversationOverrideAtom, null);
		const bridge = await import("./plugin-host-bridge.js");
		bridge.installPluginHostBridge();

		const seen: ConversationEvent[] = [];
		bridge.pluginHostBridge.conversation.on((event) => seen.push(event));
		// 订阅会回放一次当前状态，先把它放掉，剩下的才是这次覆盖引起的。
		await Promise.resolve();
		expect(seen.at(-1)).toEqual({
			type: "conversation-changed",
			conversation: expect.objectContaining({ cwd: null }),
		});

		// 团队会话从来不写 activeSessionAtom：没有这条覆盖，插件的 cwd 恒为 null，
		// 落地区挂上来的资料发送后无处可落。
		store.set(atoms.pluginConversationOverrideAtom, { id: "team-1", cwd: "/w/team" });

		const changed = seen.filter((event) => event.type === "conversation-changed");
		expect(changed.at(-1)).toEqual({
			type: "conversation-changed",
			conversation: expect.objectContaining({ id: "team-1", cwd: "/w/team" }),
		});
	});

	it("treats a different team workspace as a new conversation", async () => {
		const { getDefaultStore } = await import("jotai");
		const store = getDefaultStore();
		store.set(atoms.pluginConversationOverrideAtom, { id: "team-1", cwd: "/w/a" });
		const bridge = await import("./plugin-host-bridge.js");
		bridge.installPluginHostBridge();

		const seen: ConversationEvent[] = [];
		bridge.pluginHostBridge.conversation.on((event) => seen.push(event));
		await Promise.resolve();
		seen.length = 0;

		// 团队会话的 runtimeId 恒为 null，只比 runtimeId 会把换工作区当成「没变过」。
		store.set(atoms.pluginConversationOverrideAtom, { id: "team-1", cwd: "/w/b" });

		expect(seen.some((event) => event.type === "conversation-changed" && event.conversation?.cwd === "/w/b")).toBe(
			true,
		);
	});

	it("broadcasts turn-start on behalf of the team composer", async () => {
		const bridge = await import("./plugin-host-bridge.js");
		bridge.installPluginHostBridge();

		const seen: ConversationEvent[] = [];
		bridge.pluginHostBridge.conversation.on((event) => seen.push(event));

		// 团队会话没有插件可订阅的单一 runtime，这一声是「用户确实发出去了」的唯一来源。
		bridge.publishPluginTurnStart();

		expect(seen.some((event) => event.type === "turn-start")).toBe(true);
	});
});
