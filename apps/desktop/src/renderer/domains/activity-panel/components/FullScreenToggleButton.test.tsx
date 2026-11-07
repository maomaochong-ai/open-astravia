// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullScreenToggleButton } from "./FullScreenToggleButton";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

let fullScreen = false;
let emitChange: ((value: boolean) => void) | undefined;
const toggleFullScreen = vi.fn(async () => {
	fullScreen = !fullScreen;
	emitChange?.(fullScreen);
	return fullScreen;
});

beforeEach(() => {
	fullScreen = false;
	emitChange = undefined;
	toggleFullScreen.mockClear();
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			window: {
				isFullScreen: async () => fullScreen,
				onFullScreenChanged: (handler: (value: boolean) => void) => {
					emitChange = handler;
					return () => {
						emitChange = undefined;
					};
				},
				toggleFullScreen,
			},
		},
	});
});

afterEach(cleanup);

describe("FullScreenToggleButton", () => {
	it("starts from the window's real state, so the first click goes the right way", async () => {
		// 用户可能已经用绿灯或 Esc 进过全屏，按钮不能假设自己是「未全屏」。
		fullScreen = true;
		render(<FullScreenToggleButton />);

		await waitFor(() => expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true"));
		expect(screen.getByRole("button").getAttribute("aria-label")).toBe("tabPicker.exitFullScreen");
	});

	it("toggles the host window and follows the state pushed back from the main process", async () => {
		render(<FullScreenToggleButton />);
		await waitFor(() => expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false"));
		expect(screen.getByRole("button").getAttribute("aria-label")).toBe("tabPicker.enterFullScreen");

		fireEvent.click(screen.getByRole("button"));

		expect(toggleFullScreen).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true"));
		expect(screen.getByRole("button").getAttribute("aria-label")).toBe("tabPicker.exitFullScreen");
	});

	it("degrades quietly when the bridge has no window api instead of taking the tab bar down", () => {
		// 旧版 preload 只注入部分能力：缺方法时按钮仍在、状态停留在未全屏。
		Object.defineProperty(window, "astravia", { configurable: true, value: {} });

		render(<FullScreenToggleButton />);

		expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(screen.getByRole("button"));
		expect(toggleFullScreen).not.toHaveBeenCalled();
	});
});
