// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withThemeTransition } from "./apply.js";

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

function installMatchMedia(): void {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
	});
}

describe("withThemeTransition", () => {
	beforeEach(() => {
		installMatchMedia();
		document.documentElement.removeAttribute("data-theme-transition");
		document.documentElement.style.removeProperty("--theme-transition-x");
		document.documentElement.style.removeProperty("--theme-transition-y");
		document.documentElement.style.removeProperty("--theme-transition-radius");
	});

	it("保留从点击位置展开的圆形揭示且不把动画坐标写入根节点变量", async () => {
		const ready = deferred();
		const finished = deferred();
		const animate = vi.fn(() => ({}) as Animation);
		const update = vi.fn();

		Object.defineProperty(document.documentElement, "animate", { configurable: true, value: animate });
		Object.defineProperty(document, "startViewTransition", {
			configurable: true,
			value: vi.fn((callback: () => void) => {
				callback();
				return { ready: ready.promise, finished: finished.promise };
			}),
		});

		withThemeTransition(update, { x: 120, y: 80 });

		expect(update).toHaveBeenCalledOnce();
		expect(document.documentElement.hasAttribute("data-theme-transition")).toBe(true);
		expect(document.documentElement.style.getPropertyValue("--theme-transition-x")).toBe("");
		expect(document.documentElement.style.getPropertyValue("--theme-transition-y")).toBe("");
		expect(document.documentElement.style.getPropertyValue("--theme-transition-radius")).toBe("");

		ready.resolve();
		await ready.promise;
		await Promise.resolve();

		const radius = Math.hypot(Math.max(120, window.innerWidth - 120), Math.max(80, window.innerHeight - 80));
		expect(animate).toHaveBeenCalledWith(
			[{ clipPath: "circle(0px at 120px 80px)" }, { clipPath: `circle(${radius}px at 120px 80px)` }],
			{
				duration: 620,
				easing: "ease-in-out",
				fill: "both",
				pseudoElement: "::view-transition-new(root)",
			},
		);

		finished.resolve();
		await finished.promise;
		await Promise.resolve();
		expect(document.documentElement.hasAttribute("data-theme-transition")).toBe(false);
	});

	it("快速连续切换时只允许最后一次动画清理隔离状态", async () => {
		const firstReady = deferred();
		const firstFinished = deferred();
		const secondReady = deferred();
		const secondFinished = deferred();
		const transitions = [
			{ ready: firstReady.promise, finished: firstFinished.promise },
			{ ready: secondReady.promise, finished: secondFinished.promise },
		];
		let index = 0;
		const animate = vi.fn(() => ({}) as Animation);

		Object.defineProperty(document.documentElement, "animate", {
			configurable: true,
			value: animate,
		});
		Object.defineProperty(document, "startViewTransition", {
			configurable: true,
			value: vi.fn((callback: () => void) => {
				callback();
				return transitions[index++];
			}),
		});

		withThemeTransition(() => {}, { x: 10, y: 20 });
		withThemeTransition(() => {}, { x: 30, y: 40 });

		firstReady.resolve();
		await firstReady.promise;
		await Promise.resolve();
		expect(animate).not.toHaveBeenCalled();

		secondReady.resolve();
		await secondReady.promise;
		await Promise.resolve();
		expect(animate).toHaveBeenCalledOnce();

		firstFinished.resolve();
		await firstFinished.promise;
		await Promise.resolve();
		expect(document.documentElement.hasAttribute("data-theme-transition")).toBe(true);

		secondFinished.resolve();
		await secondFinished.promise;
		await Promise.resolve();
		expect(document.documentElement.hasAttribute("data-theme-transition")).toBe(false);
	});
});
