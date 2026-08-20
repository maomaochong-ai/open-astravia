// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const atoms = await import("@shared/store/atoms");
const { useChatPageModel } = await import("./useChatPageModel");

describe("useChatPageModel internal session transition", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(atoms.activeSessionAtom, null);
		store.set(atoms.pendingSessionCreationAtom, null);
		store.set(atoms.pendingSessionOpenAtom, null);
	});

	it("已有会话恢复期间只提供路由与输入上下文", () => {
		act(() => {
			getDefaultStore().set(atoms.pendingSessionOpenAtom, {
				cwd: "/repo/a",
				sessionPath: "/sessions/a.jsonl",
				interactionId: "open-a",
			});
		});

		const { result } = renderHook(() => useChatPageModel());

		expect(result.current.hasActiveSession).toBe(true);
		expect(result.current.pendingCwd).toBe("/repo/a");
		expect(result.current).not.toHaveProperty("sessionPending");
	});

	it("新会话创建期间同样不产生展示层 pending 合同", () => {
		act(() => {
			getDefaultStore().set(atoms.pendingSessionCreationAtom, {
				cwd: "/repo/a",
				interactionId: "create-a",
			});
		});

		const { result } = renderHook(() => useChatPageModel());

		expect(result.current.hasActiveSession).toBe(true);
		expect(result.current.pendingCwd).toBe("/repo/a");
		expect(result.current).not.toHaveProperty("sessionPendingLabel");
	});
});
