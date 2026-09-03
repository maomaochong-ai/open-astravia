// @vitest-environment jsdom
/**
 * 吉祥物按插槽（hero 宽度）决定是否渲染：页面被压窄时（窗口小、活动面板/侧边栏展开）
 * 素材右锚会压到选项行与标题上，这时整块吉祥物连同显隐按钮都不该出现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

import { act, render, screen } from "@testing-library/react";
import { MASCOT_MIN_SLOT_WIDTH } from "./constants";
import { NewSessionMascot } from "./NewSessionMascot";

type ResizeCallback = (entries: { contentRect: { width: number } }[]) => void;

let resizeCallbacks: ResizeCallback[];
let slotWidth: number;

class ResizeObserverStub {
	constructor(private readonly callback: ResizeCallback) {
		resizeCallbacks.push(callback);
	}
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function resizeSlot(width: number): void {
	slotWidth = width;
	act(() => {
		for (const callback of resizeCallbacks) callback([{ contentRect: { width } }]);
	});
}

beforeEach(() => {
	resizeCallbacks = [];
	slotWidth = MASCOT_MIN_SLOT_WIDTH;
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		() => ({ width: slotWidth, height: 80 }) as DOMRect,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("NewSessionMascot", () => {
	it("插槽够宽时渲染吉祥物与显隐按钮", () => {
		slotWidth = MASCOT_MIN_SLOT_WIDTH;
		render(<NewSessionMascot autoplay={false} mounted />);

		expect(screen.getByRole("button", { name: "newSession.mascot.hideMascot" })).toBeTruthy();
	});

	it("插槽过窄时整块吉祥物不渲染", () => {
		slotWidth = MASCOT_MIN_SLOT_WIDTH - 1;
		render(<NewSessionMascot autoplay={false} mounted />);

		expect(screen.queryByRole("button", { name: "newSession.mascot.hideMascot" })).toBeNull();
	});

	it("插槽被压窄后收起、变宽后恢复", () => {
		render(<NewSessionMascot autoplay={false} mounted />);

		resizeSlot(MASCOT_MIN_SLOT_WIDTH - 40);
		expect(screen.queryByRole("button", { name: "newSession.mascot.hideMascot" })).toBeNull();

		resizeSlot(MASCOT_MIN_SLOT_WIDTH + 40);
		expect(screen.getByRole("button", { name: "newSession.mascot.hideMascot" })).toBeTruthy();
	});
});
