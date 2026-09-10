// @vitest-environment jsdom
/**
 * 火把装饰件的交互契约：点一下灭、再点一下重新点着，且这个选择要记住；
 * 关掉「头像动效」或系统要求减少动效时火光不跳动，但仍然点得灭。
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
import { TorchOrnament } from "./TorchOrnament";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function torchRoot(): HTMLElement {
	const root = document.querySelector(".ns-torch");
	if (!(root instanceof HTMLElement)) throw new Error("火把没渲染出来");
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

describe("TorchOrnament", () => {
	it("默认点着，点一下熄灭、再点一下重新点着", async () => {
		const user = userEvent.setup();
		render(<TorchOrnament autoplay mounted />);

		expect(torchRoot().dataset.lit).toBe("true");

		await user.click(screen.getByRole("button", { name: "newSession.torch.extinguish" }));
		expect(torchRoot().dataset.lit).toBe("false");

		await user.click(screen.getByRole("button", { name: "newSession.torch.light" }));
		expect(torchRoot().dataset.lit).toBe("true");
	});

	it("熄灭后记在本地，重开还是灭的", async () => {
		const user = userEvent.setup();
		const { unmount } = render(<TorchOrnament autoplay mounted />);

		await user.click(screen.getByRole("button", { name: "newSession.torch.extinguish" }));
		unmount();

		render(<TorchOrnament autoplay mounted />);
		expect(torchRoot().dataset.lit).toBe("false");
	});

	it("关掉头像动效时火光不跳动，但仍然点得灭", async () => {
		const user = userEvent.setup();
		render(<TorchOrnament autoplay={false} mounted />);

		expect(torchRoot().dataset.animate).toBe("false");

		await user.click(screen.getByRole("button", { name: "newSession.torch.extinguish" }));
		expect(torchRoot().dataset.lit).toBe("false");
	});

	it("系统要求减少动效时火光同样不跳动", () => {
		reduceMotion = true;
		render(<TorchOrnament autoplay mounted />);

		expect(torchRoot().dataset.animate).toBe("false");
	});
});
