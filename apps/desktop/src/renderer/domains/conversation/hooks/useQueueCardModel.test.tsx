// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { initI18n } from "@shared/i18n";
import { isCompactingAtom } from "@shared/store/atoms";
import { messageQueueBySessionAtom } from "@shared/store/message-queue-atoms";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
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
});
