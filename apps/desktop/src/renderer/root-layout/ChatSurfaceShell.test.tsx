// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { activeSessionAtom, sessionsMapAtom } from "@shared/store/atoms";
import { ChatSurfaceShell } from "./ChatSurfaceShell";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

describe("ChatSurfaceShell", () => {
	it("还没有会话时主区立刻画出默认会话标题", () => {
		const store = createStore();
		const { getByRole, container } = render(<ChatSurfaceShell />, {
			wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
		});
		expect(getByRole("heading", { level: 1 }).textContent).toBe("chatView.defaultSessionTitle");
		expect(container.querySelector(".animate-pulse")).toBeNull();
		expect(container.querySelector("[aria-busy='true']")).toBeNull();
	});

	it("已有会话时主区用会话展示名，不等 ChatPage", () => {
		const store = createStore();
		store.set(activeSessionAtom, {
			sessionPath: "/sessions/a.jsonl",
			cwd: "/repo/a",
			runtimeId: "rt",
		});
		store.set(
			sessionsMapAtom,
			new Map([
				[
					"/repo/a",
					[
						{
							id: "a",
							path: "/sessions/a.jsonl",
							cwd: "/repo/a",
							name: "周报",
							firstMessage: "hi",
							modifiedAt: 0,
						},
					],
				],
			]),
		);
		const { getByRole } = render(<ChatSurfaceShell />, {
			wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
		});
		expect(getByRole("heading", { level: 1 }).textContent).toBe("周报");
	});
});
