// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const atoms = await import("@shared/store/atoms");
const { useChatPageModel } = await import("./useChatPageModel");

describe("useChatPageModel session pending presentation", () => {
	beforeEach(() => {
		const store = getDefaultStore();
		store.set(atoms.activeSessionAtom, null);
		store.set(atoms.pendingSessionCreationAtom, null);
		store.set(atoms.pendingSessionOpenAtom, null);
	});

	it("已有会话恢复期间禁用交互但不展示短生命周期提示", () => {
		act(() => {
			getDefaultStore().set(atoms.pendingSessionOpenAtom, {
				cwd: "/repo/a",
				sessionPath: "/sessions/a.jsonl",
				interactionId: "open-a",
			});
		});

		const { result } = renderHook(() => useChatPageModel());

		expect(result.current.hasActiveSession).toBe(true);
		expect(result.current.sessionPending).toBe(true);
		expect(result.current.sessionPendingLabel).toBeUndefined();
	});

	it("新会话没有历史可展示时保留启动提示", () => {
		act(() => {
			getDefaultStore().set(atoms.pendingSessionCreationAtom, {
				cwd: "/repo/a",
				interactionId: "create-a",
			});
		});

		const { result } = renderHook(() => useChatPageModel());

		expect(result.current.sessionPending).toBe(true);
		expect(result.current.sessionPendingLabel).toBe("chatView.startingSession");
	});
});
