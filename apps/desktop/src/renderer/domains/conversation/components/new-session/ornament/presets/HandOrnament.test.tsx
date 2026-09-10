// @vitest-environment jsdom
/**
 * 玩手装饰件的交互契约：点一下手收成拳头、再点一下接着敲，且这个选择要记住；
 * 关掉「头像动效」或系统要求减少动效时手指不敲，但仍然收得起来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let reduceMotion = false;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("motion/react", async () => {
	const actual = await vi.importActual<typeof import("motion/react")>("motion/react");
	return { ...actual, useReducedMotion: () => reduceMotion };
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HandOrnament } from "./HandOrnament";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function handRoot(): HTMLElement {
	const root = document.querySelector(".ns-hand");
	if (!(root instanceof HTMLElement)) throw new Error("手没渲染出来");
	return root;
}

beforeEach(() => {
	reduceMotion = false;
	window.localStorage.clear();
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	// 插槽够宽装饰件才渲染；窄插槽的收起逻辑由 useOrnamentSlot 自己的用例覆盖。
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		() => ({ width: 800, height: 80 }) as DOMRect,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("HandOrnament", () => {
	it("默认在敲，点一下收成拳头、再点一下接着敲", async () => {
		const user = userEvent.setup();
		render(<HandOrnament autoplay mounted />);

		expect(handRoot().dataset.tapping).toBe("true");

		await user.click(screen.getByRole("button", { name: "newSession.hand.rest" }));
		expect(handRoot().dataset.tapping).toBe("false");

		await user.click(screen.getByRole("button", { name: "newSession.hand.tap" }));
		expect(handRoot().dataset.tapping).toBe("true");
	});

	it("收起来之后记在本地，重开手还是收着的", async () => {
		const user = userEvent.setup();
		const { unmount } = render(<HandOrnament autoplay mounted />);

		await user.click(screen.getByRole("button", { name: "newSession.hand.rest" }));
		unmount();

		render(<HandOrnament autoplay mounted />);
		expect(handRoot().dataset.tapping).toBe("false");
	});

	it("关掉头像动效时手指不敲，但仍然收得起来", async () => {
		const user = userEvent.setup();
		render(<HandOrnament autoplay={false} mounted />);

		expect(handRoot().dataset.animate).toBe("false");

		await user.click(screen.getByRole("button", { name: "newSession.hand.rest" }));
		expect(handRoot().dataset.tapping).toBe("false");
	});

	it("系统要求减少动效时手指同样不敲", () => {
		reduceMotion = true;
		render(<HandOrnament autoplay mounted />);

		expect(handRoot().dataset.animate).toBe("false");
	});
});
