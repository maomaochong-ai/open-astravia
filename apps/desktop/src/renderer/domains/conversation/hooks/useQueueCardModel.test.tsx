// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { initI18n } from "@shared/i18n";
import { isCompactingAtom } from "@shared/store/atoms";
import { inputValueAtom } from "@shared/store/chat-atoms";
import {
	getQueueForSession,
	messageQueueBySessionAtom,
	setQueueForSessionAtom,
} from "@shared/store/message-queue-atoms";
import { appendToSessionInputDraft } from "@shared/store/session-input-draft";
import { createStore, getDefaultStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useQueueCardModel } from "./useQueueCardModel";

initI18n();

describe("useQueueCardModel compaction barrier", () => {
	it("只允许压缩屏障前的消息立即发送，并在压缩执行中禁用所有立即发送入口", () => {
		const store = createStore();
		store.set(
			messageQueueBySessionAtom,
			new Map([
				[
					"session-1",
					[
						{ id: "before", behavior: "followUp", kind: "message", displayText: "before" },
						{
							id: "compact",
							behavior: "followUp",
							kind: "context_compaction",
							displayText: "context.compact",
						},
						{ id: "after", behavior: "followUp", kind: "message", displayText: "after" },
					],
				],
			]),
		);
		store.set(isCompactingAtom, false);
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
		const { result } = renderHook(() => useQueueCardModel("session-1"), { wrapper });

		expect(result.current.items.map((item) => [item.id, item.canSendNow])).toEqual([
			["before", true],
			["compact", false],
			["after", false],
		]);

		act(() => store.set(isCompactingAtom, true));
		expect(result.current.items.find((item) => item.id === "before")?.canSendNow).toBe(false);
	});

	it("撤回把消息移出队列并把原文写回输入草稿", async () => {
		const removeQueuedMessage = vi.fn(async () => true);
		vi.stubGlobal("astravia", { session: { removeQueuedMessage } });

		// 生产环境没有 jotai Provider，草稿工具直接写默认 store，测试必须跟着用同一份。
		const store = getDefaultStore();
		store.set(
			messageQueueBySessionAtom,
			new Map([
				[
					"session-1",
					[
						{ id: "keep", behavior: "followUp", kind: "message", displayText: "留下" },
						{ id: "m1", behavior: "followUp", kind: "message", displayText: "把这句话改一下" },
					],
				],
			]),
		);
		const { result } = renderHook(() => useQueueCardModel("session-1"));

		await act(async () => result.current.onRecall("m1"));

		expect(removeQueuedMessage).toHaveBeenCalledWith("session-1", "m1");
		expect(getQueueForSession(store.get(messageQueueBySessionAtom), "session-1").map((item) => item.id)).toEqual(["keep"]);
		expect(store.get(inputValueAtom)).toBe("把这句话改一下");
	});

	it("出队失败时既不改草稿，也不把消息从队列里抹掉", async () => {
		const removeQueuedMessage = vi.fn(async () => {
			throw new Error("host gone");
		});
		vi.stubGlobal("astravia", { session: { removeQueuedMessage } });
		vi.spyOn(console, "warn").mockImplementation(() => {});

		const store = getDefaultStore();
		store.set(inputValueAtom, "");
		store.set(
			messageQueueBySessionAtom,
			new Map([
				[
					"session-1",
					[
						{ id: "keep", behavior: "followUp", kind: "message", displayText: "留下" },
						{ id: "m2", behavior: "followUp", kind: "message", displayText: "别丢这句" },
					],
				],
			]),
		);
		const { result } = renderHook(() => useQueueCardModel("session-1"));

		await act(async () => result.current.onRecall("m2"));

		expect(store.get(inputValueAtom)).toBe("");
		expect(getQueueForSession(store.get(messageQueueBySessionAtom), "session-1").map((item) => item.id)).toEqual([
			"keep",
			"m2",
		]);
	});

	it("撤回时草稿已有内容则另起一行追加，不覆盖正在写的内容", () => {
		vi.stubGlobal("astravia", { session: { removeQueuedMessage: vi.fn(async () => true) } });
		const store = getDefaultStore();
		store.set(inputValueAtom, "我正在写");

		act(() => appendToSessionInputDraft("排队那句"));

		expect(store.get(inputValueAtom)).toBe("我正在写\n排队那句");
	});
});
