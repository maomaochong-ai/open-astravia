// @vitest-environment jsdom
/**
 * 星轨装饰件的交互契约：指上去切到 speaking、移开切回 idle；
 * 关掉「头像动效」时球停帧，hover 也不该让它动起来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let reduceMotion = false;

vi.mock("motion/react", async () => {
	const actual = await vi.importActual<typeof import("motion/react")>("motion/react");
	return { ...actual, useReducedMotion: () => reduceMotion };
});

vi.mock("@shared/components/orb/OrbitOrb", () => ({
	OrbitOrb: ({ state, paused }: { state?: string; paused?: boolean }) => (
		<div data-testid="orb" data-state={state} data-paused={String(paused)} />
	),
}));

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrbitOrnament } from "./OrbitOrnament";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

beforeEach(() => {
	reduceMotion = false;
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	// 插槽够宽，装饰件才会渲染；窄插槽的收起逻辑由 useOrnamentSlot 自己的用例覆盖。
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		() => ({ width: 800, height: 80 }) as DOMRect,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("OrbitOrnament", () => {
	it("指上去切到 speaking，移开切回 idle", async () => {
		const user = userEvent.setup();
		render(<OrbitOrnament autoplay mounted />);
		const orb = screen.getByTestId("orb");

		expect(orb.dataset.state).toBe("idle");

		await user.hover(orb);
		expect(screen.getByTestId("orb").dataset.state).toBe("speaking");

		await user.unhover(orb);
		expect(screen.getByTestId("orb").dataset.state).toBe("idle");
	});

	it("关掉头像动效时球停帧，hover 不改变形态", async () => {
		const user = userEvent.setup();
		render(<OrbitOrnament autoplay={false} mounted />);
		const orb = screen.getByTestId("orb");

		expect(orb.dataset.paused).toBe("true");

		await user.hover(orb);
		expect(screen.getByTestId("orb").dataset.state).toBe("idle");
	});

	it("系统要求减少动效时同样不响应 hover", async () => {
		reduceMotion = true;
		const user = userEvent.setup();
		render(<OrbitOrnament autoplay mounted />);
		const orb = screen.getByTestId("orb");

		await user.hover(orb);
		expect(screen.getByTestId("orb").dataset.state).toBe("idle");
	});
});
