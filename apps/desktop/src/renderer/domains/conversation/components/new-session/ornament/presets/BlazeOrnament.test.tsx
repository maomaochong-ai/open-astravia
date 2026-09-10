// @vitest-environment jsdom
/**
 * 燃烧装饰件的契约：它不接交互，能测的就是「什么时候烧、什么时候停」——
 * 插槽够宽才画，关掉「头像动效」或系统要求减少动效时火苗停在静息帧。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let reduceMotion = false;
let slotWidth = 800;

vi.mock("motion/react", async () => {
	const actual = await vi.importActual<typeof import("motion/react")>("motion/react");
	return { ...actual, useReducedMotion: () => reduceMotion };
});

import { render } from "@testing-library/react";
import { BlazeOrnament } from "./BlazeOrnament";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function blazeRoot(): HTMLElement | null {
	const root = document.querySelector(".ns-blaze");
	return root instanceof HTMLElement ? root : null;
}

beforeEach(() => {
	reduceMotion = false;
	slotWidth = 800;
	vi.stubGlobal("ResizeObserver", ResizeObserverStub);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		() => ({ width: slotWidth, height: 80 }) as DOMRect,
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("BlazeOrnament", () => {
	it("插槽够宽时烧着", () => {
		render(<BlazeOrnament autoplay mounted />);

		expect(blazeRoot()?.dataset.animate).toBe("true");
	});

	it("插槽太窄时整块不画", () => {
		slotWidth = 240;
		render(<BlazeOrnament autoplay mounted />);

		expect(blazeRoot()).toBeNull();
	});

	it("关掉头像动效时火苗停下，但火还在", () => {
		render(<BlazeOrnament autoplay={false} mounted />);

		expect(blazeRoot()?.dataset.animate).toBe("false");
	});

	it("系统要求减少动效时火苗同样停下", () => {
		reduceMotion = true;
		render(<BlazeOrnament autoplay mounted />);

		expect(blazeRoot()?.dataset.animate).toBe("false");
	});

	it("并排两团各用各的遮罩，不互相抢", () => {
		render(
			<>
				<BlazeOrnament autoplay mounted />
				<BlazeOrnament autoplay mounted />
			</>,
		);

		const ids = [...document.querySelectorAll("mask")].map((mask) => mask.id);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
	});
});
