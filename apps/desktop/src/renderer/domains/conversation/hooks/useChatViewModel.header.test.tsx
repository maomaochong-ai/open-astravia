// @vitest-environment jsdom
import { ChatSurfaceActiveContext } from "@shared/chat-surface-active";
import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/**
 * 发送链路级联提交的合同：ChatView 把 actions/header memo 成 header slot 元素写进
 * 全局 pageHeader atom。发送/流式期间消息数组高频换引用，若 actions/header 跟着换
 * 引用，每条消息都会多一轮 RootLayout header 提交；activeSession 的无关字段（token
 * 计数等）变动也不得触发重算。
 */

vi.mock("react-i18next", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t, i18n: { language: "zh" } }) };
});

const { useChatViewModel } = await import("./useChatViewModel.js");
const atoms = await import("@shared/store/atoms");

function stubVettaWindow(): void {
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			window: {
				isAlwaysOnTop: async () => false,
				toggleAlwaysOnTop: async () => true,
			},
		},
	});
}

function makeActiveSession(extra: Record<string, unknown> = {}) {
	return {
		runtimeId: "rt-1",
		sessionPath: "/sessions/a.jsonl",
		cwd: "/repo/a",
		...extra,
	} as never;
}

function renderChatViewModel(initialActive = true) {
	const surface = { current: initialActive };
	const view = renderHook(() => useChatViewModel(), {
		wrapper: ({ children }: { children: ReactNode }) => (
			<ChatSurfaceActiveContext.Provider value={surface.current}>{children}</ChatSurfaceActiveContext.Provider>
		),
	});
	return {
		...view,
		setActive(next: boolean) {
			surface.current = next;
			view.rerender();
		},
	};
}

describe("useChatViewModel 引用稳定性", () => {
	beforeEach(() => {
		stubVettaWindow();
		const store = getDefaultStore();
		store.set(atoms.chatMessagesAtom, [
			{ id: "m1", role: "user", blocks: [{ type: "text", text: "hi" }] },
		] as never);
		store.set(atoms.activeSessionAtom, makeActiveSession());
		store.set(atoms.pendingSessionOpenAtom, null);
		store.set(atoms.pageHeaderTitleAtom, null);
	});

	it("追加消息（非空→非空）不改变 actions / header 引用", () => {
		const { result, rerender } = renderChatViewModel();
		const firstActions = result.current.actions;
		const firstHeader = result.current.model.header;

		act(() => {
			const store = getDefaultStore();
			const prev = store.get(atoms.chatMessagesAtom);
			store.set(atoms.chatMessagesAtom, [
				...prev,
				{ id: "m2", role: "user", blocks: [{ type: "text", text: "again" }] },
			] as never);
		});
		rerender();

		expect(result.current.actions).toBe(firstActions);
		expect(result.current.model.header).toBe(firstHeader);
		expect(result.current.model.messages).toHaveLength(2);
	});

	it("activeSession 无关字段变动不改变 header 引用与 sessionId", () => {
		const { result, rerender } = renderChatViewModel();
		const firstHeader = result.current.model.header;

		act(() => {
			getDefaultStore().set(atoms.activeSessionAtom, makeActiveSession({ contextUsage: { used: 1234 } }));
		});
		rerender();

		expect(result.current.model.header).toBe(firstHeader);
		expect(result.current.model.sessionId).toBe("/sessions/a.jsonl");
	});

	it("空列表→有消息才更新 header（导出按钮可用性翻转）", () => {
		act(() => {
			getDefaultStore().set(atoms.chatMessagesAtom, [] as never);
		});
		const { result, rerender } = renderChatViewModel();
		expect(result.current.model.header.exportDisabled).toBe(true);

		act(() => {
			getDefaultStore().set(atoms.chatMessagesAtom, [
				{ id: "m1", role: "user", blocks: [{ type: "text", text: "hi" }] },
			] as never);
		});
		rerender();
		expect(result.current.model.header.exportDisabled).toBe(false);
	});

	it("切到其它页后清掉自己的顶栏标题，隐藏态卸载不再清别人的", () => {
		const view = renderChatViewModel(true);
		expect(getDefaultStore().get(atoms.pageHeaderTitleAtom)).not.toBeNull();

		act(() => {
			view.setActive(false);
		});
		expect(getDefaultStore().get(atoms.pageHeaderTitleAtom)).toBeNull();

		act(() => {
			getDefaultStore().set(atoms.pageHeaderTitleAtom, "Settings");
		});
		view.unmount();
		expect(getDefaultStore().get(atoms.pageHeaderTitleAtom)).toBe("Settings");
	});

	it("聊天页不在前台时消息流不再驱动 view model", () => {
		const { result, rerender } = renderChatViewModel(false);
		const frozen = result.current.model.messages;

		act(() => {
			const store = getDefaultStore();
			const prev = store.get(atoms.chatMessagesAtom);
			store.set(atoms.chatMessagesAtom, [
				...prev,
				{ id: "m-hidden", role: "user", blocks: [{ type: "text", text: "后台" }] },
			] as never);
		});
		rerender();
		expect(result.current.model.messages).toBe(frozen);
		expect(result.current.model.messages).toHaveLength(1);
	});

	it("打开已有会话时用目标路径稳定列表身份，并进入历史预览模式", () => {
		const { result, rerender } = renderChatViewModel();

		act(() => {
			getDefaultStore().set(atoms.pendingSessionOpenAtom, {
				cwd: "/repo/b",
				sessionPath: "/sessions/b.jsonl",
				interactionId: "open-b",
			});
			getDefaultStore().set(atoms.activeSessionAtom, null);
		});
		rerender();

		expect(result.current.model.sessionId).toBe("/sessions/b.jsonl");
	});

	it("其它会话列表更新不改当前会话标题", () => {
		const store = getDefaultStore();
		store.set(
			atoms.sessionsMapAtom,
			new Map([
				[
					"/repo/a",
					[{ id: "a", path: "/sessions/a.jsonl", cwd: "/repo/a", firstMessage: "当前会话", modifiedAt: 1 }],
				],
			]),
		);
		const { result, rerender } = renderChatViewModel();
		expect(result.current.model.exportTitle).toBe("当前会话");

		act(() => {
			store.set(
				atoms.sessionsMapAtom,
				new Map([
					[
						"/repo/a",
						[{ id: "a", path: "/sessions/a.jsonl", cwd: "/repo/a", firstMessage: "当前会话", modifiedAt: 1 }],
					],
					[
						"/repo/b",
						[{ id: "b", path: "/sessions/b.jsonl", cwd: "/repo/b", firstMessage: "别的会话", modifiedAt: 2 }],
					],
				]),
			);
		});
		rerender();
		expect(result.current.model.exportTitle).toBe("当前会话");
	});
});
