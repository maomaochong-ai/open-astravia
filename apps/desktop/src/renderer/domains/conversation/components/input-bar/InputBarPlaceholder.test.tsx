// @vitest-environment jsdom
import { InputBarPlaceholder } from "@vetta-org/theme-ui/chat";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// 轮播的滑入滑出由 motion 负责，这里只关心「当前展示哪条文案」。
vi.mock("motion/react", () => ({
	AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
	motion: {
		span: ({ children, className }: { children: ReactNode; className?: string }) => (
			<span className={className}>{children}</span>
		),
	},
}));

const TEXTS = ["问我任何问题", "让我帮你改代码"] as const;

function setWindowFocused(focused: boolean): void {
	vi.spyOn(document, "hasFocus").mockReturnValue(focused);
	act(() => {
		window.dispatchEvent(new Event(focused ? "focus" : "blur"));
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("窗口在前台时，占位文案按间隔轮播到下一条", () => {
	render(<InputBarPlaceholder texts={TEXTS} visible intervalMs={4000} />);
	expect(screen.getByText(TEXTS[0])).toBeTruthy();

	act(() => {
		vi.advanceTimersByTime(4000);
	});

	expect(screen.getByText(TEXTS[1])).toBeTruthy();
});

it("用户切到别的应用后轮播暂停，切回来后继续", () => {
	render(<InputBarPlaceholder texts={TEXTS} visible intervalMs={4000} />);

	setWindowFocused(false);
	act(() => {
		vi.advanceTimersByTime(20_000);
	});
	expect(screen.getByText(TEXTS[0])).toBeTruthy();

	setWindowFocused(true);
	act(() => {
		vi.advanceTimersByTime(4000);
	});
	expect(screen.getByText(TEXTS[1])).toBeTruthy();
});
