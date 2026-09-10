// @vitest-environment jsdom
/**
 * 能源井装饰件的契约：它不接交互，能测的就是「什么时候运转、什么时候停」——
 * 插槽够宽才画，关掉「头像动效」或系统要求减少动效时整座井停在静息帧。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let reduceMotion = false;
let slotWidth = 800;

vi.mock("motion/react", async () => {
	const actual = await vi.importActual<typeof import("motion/react")>("motion/react");
	return { ...actual, useReducedMotion: () => reduceMotion };
});

import { render } from "@testing-library/react";
import { EnergyWellOrnament } from "./EnergyWellOrnament";

class ResizeObserverStub {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

function wellRoot(): SVGElement | null {
	const root = document.querySelector(".ns-well");
	return root instanceof SVGElement ? root : null;
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

describe("EnergyWellOrnament", () => {
	it("插槽够宽时运转着", () => {
		render(<EnergyWellOrnament autoplay mounted />);

		expect(wellRoot()?.getAttribute("data-animate")).toBe("true");
	});

	it("插槽太窄时整块不画", () => {
		slotWidth = 240;
		render(<EnergyWellOrnament autoplay mounted />);

		expect(wellRoot()).toBeNull();
	});

	it("关掉头像动效时井停下，但井还在", () => {
		render(<EnergyWellOrnament autoplay={false} mounted />);

		expect(wellRoot()?.getAttribute("data-animate")).toBe("false");
	});

	it("系统要求减少动效时井同样停下", () => {
		reduceMotion = true;
		render(<EnergyWellOrnament autoplay mounted />);

		expect(wellRoot()?.getAttribute("data-animate")).toBe("false");
	});

	it("并排两座各用各的渐变与遮罩，不互相抢", () => {
		render(
			<>
				<EnergyWellOrnament autoplay mounted />
				<EnergyWellOrnament autoplay mounted />
			</>,
		);

		const ids = [...document.querySelectorAll("linearGradient, mask")].map((node) => node.id);
		expect(ids.length).toBeGreaterThan(0);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
