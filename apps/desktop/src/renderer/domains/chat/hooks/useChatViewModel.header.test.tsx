// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 发送链路级联提交的合同：ChatView 把 actions/header memo 成 header slot 元素写进
 * 全局 pageHeader atom。发送/流式期间消息数组高频换引用，若 actions/header 跟着换
 * 引用，每条消息都会多一轮 RootLayout header 提交；activeSession 的无关字段（token
 * 计数等）变动也不得触发重算。
 */

// t 固定为稳定引用，与真实 react-i18next 行为一致（同一 i18n 实例下 t 身份稳定）。
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
	} as unknown as ReturnType<typeof getDefaultStore>["get"] extends never ? never : never;
}

describe("useChatViewModel 引用稳定性", () => {
	beforeEach(() => {
		stubVettaWindow();
		const store = getDefaultStore();
		store.set(atoms.chatMessagesAtom, [
			{ id: "m1", role: "user", blocks: [{ type: "text", text: "hi" }] },
		] as never);
		store.set(atoms.activeSessionAtom, makeActiveSession() as never);
	});

	it("追加消息（非空→非空）不改变 actions / header 引用", () => {
		const { result, rerender } = renderHook(() => useChatViewModel());
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
		// 消息本身照常透传。
		expect(result.current.model.messages).toHaveLength(2);
	});

	it("activeSession 无关字段变动不改变 header 引用与 sessionId", () => {
		const { result, rerender } = renderHook(() => useChatViewModel());
		const firstHeader = result.current.model.header;

		act(() => {
			getDefaultStore().set(
				atoms.activeSessionAtom,
				makeActiveSession({ contextUsage: { used: 1234 } }) as never,
			);
		});
		rerender();

		expect(result.current.model.header).toBe(firstHeader);
		expect(result.current.model.sessionId).toBe("/sessions/a.jsonl");
	});

	it("空列表→有消息才更新 header（导出按钮可用性翻转）", () => {
		act(() => {
			getDefaultStore().set(atoms.chatMessagesAtom, [] as never);
		});
		const { result, rerender } = renderHook(() => useChatViewModel());
		expect(result.current.model.header.exportDisabled).toBe(true);

		act(() => {
			getDefaultStore().set(atoms.chatMessagesAtom, [
				{ id: "m1", role: "user", blocks: [{ type: "text", text: "hi" }] },
			] as never);
		});
		rerender();
		expect(result.current.model.header.exportDisabled).toBe(false);
	});
});
