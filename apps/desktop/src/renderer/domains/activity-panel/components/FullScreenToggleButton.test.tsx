// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullScreenToggleButton } from "./FullScreenToggleButton";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe("FullScreenToggleButton", () => {
	it("未铺满时显示放大图标，点击后把状态交给调用方", () => {
		const onToggle = vi.fn();
		render(<FullScreenToggleButton isFullScreen={false} onToggle={onToggle} />);
		const button = screen.getByRole("button");

		expect(button.getAttribute("aria-label")).toBe("tabPicker.enterFullScreen");
		expect(button.getAttribute("aria-pressed")).toBe("false");
		expect(button.innerHTML).toContain("icon-[solar--maximize-square-3-linear]");

		fireEvent.click(button);

		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it("铺满后换成缩小图标，避免一直显示同一个图标", () => {
		render(<FullScreenToggleButton isFullScreen onToggle={vi.fn()} />);
		const button = screen.getByRole("button");

		expect(button.getAttribute("aria-label")).toBe("tabPicker.exitFullScreen");
		expect(button.getAttribute("aria-pressed")).toBe("true");
		expect(button.innerHTML).toContain("icon-[solar--minimize-square-3-linear]");
		expect(button.innerHTML).not.toContain("icon-[solar--maximize-square-3-linear]");
	});
});
