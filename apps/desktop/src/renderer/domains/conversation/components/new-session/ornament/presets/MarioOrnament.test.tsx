// @vitest-environment jsdom
/**
 * 马里奥装饰件的交互契约：顶一下问号砖块蹦出蘑菇、再顶一下收回去，且这个选择要记住；
 * 关掉「头像动效」或系统要求减少动效时蘑菇不蹦，但仍然顶得出来。
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
import { MarioOrnament } from "./MarioOrnament";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function marioRoot(): HTMLElement {
	const root = document.querySelector(".ns-mario");
	if (!(root instanceof HTMLElement)) throw new Error("砖块没渲染出来");
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

describe("MarioOrnament", () => {
	it("默认没顶过，顶一下蹦出蘑菇、再顶一下收回去", async () => {
		const user = userEvent.setup();
		render(<MarioOrnament autoplay mounted />);

		expect(marioRoot().dataset.popped).toBe("false");

		await user.click(screen.getByRole("button", { name: "newSession.mario.hit" }));
		expect(marioRoot().dataset.popped).toBe("true");

		await user.click(screen.getByRole("button", { name: "newSession.mario.reset" }));
		expect(marioRoot().dataset.popped).toBe("false");
	});

	it("顶出来之后记在本地，重开蘑菇还在外面", async () => {
		const user = userEvent.setup();
		const { unmount } = render(<MarioOrnament autoplay mounted />);

		await user.click(screen.getByRole("button", { name: "newSession.mario.hit" }));
		unmount();

		render(<MarioOrnament autoplay mounted />);
		expect(marioRoot().dataset.popped).toBe("true");
	});

	it("关掉头像动效时蘑菇不蹦，但仍然顶得出来", async () => {
		const user = userEvent.setup();
		render(<MarioOrnament autoplay={false} mounted />);

		expect(marioRoot().dataset.animate).toBe("false");

		await user.click(screen.getByRole("button", { name: "newSession.mario.hit" }));
		expect(marioRoot().dataset.popped).toBe("true");
	});

	it("系统要求减少动效时蘑菇同样不蹦", () => {
		reduceMotion = true;
		render(<MarioOrnament autoplay mounted />);

		expect(marioRoot().dataset.animate).toBe("false");
	});
});
