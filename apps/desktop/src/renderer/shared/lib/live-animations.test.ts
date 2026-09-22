// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLiveAnimations, LIVE_ANIMATION_SELECTORS } from "./live-animations";

interface FakeAnimation {
	keyframes: Keyframe[];
	options: KeyframeAnimationOptions;
	startTime: number | null;
	cancel: ReturnType<typeof vi.fn>;
}

let created: Array<{ element: Element; animation: FakeAnimation }> = [];
let uninstall: (() => void) | undefined;

/** MutationObserver 回调走微任务；等一轮让它跑完。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	created = [];
	// jsdom 没有 Web Animations：只关心本模块建了什么动画、锁到了哪个起点。
	Object.defineProperty(Element.prototype, "animate", {
		configurable: true,
		value(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
			const animation: FakeAnimation = { keyframes, options, startTime: null, cancel: vi.fn() };
			created.push({ element: this, animation });
			return animation;
		},
	});
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
	uninstall?.();
	uninstall = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

function mount(className: string): HTMLElement {
	const element = document.createElement("span");
	element.className = className;
	document.body.appendChild(element);
	return element;
}

describe("installLiveAnimations", () => {
	it("gives every registered indicator a stepped infinite animation locked to the document timeline origin", () => {
		const shimmer = mount("processing-shimmer");
		const ripple2 = mount("send-button-ripple send-button-ripple-2");
		uninstall = installLiveAnimations();

		expect(created.map((entry) => entry.element)).toEqual([shimmer, ripple2]);
		for (const { animation } of created) {
			expect(animation.options).toMatchObject({
				duration: 1600,
				easing: "steps(16, end)",
				iterations: Number.POSITIVE_INFINITY,
			});
		}
		// 同一相位：不管元素何时挂载都从时间线原点起算；第二圈波纹错开半周。
		expect(created[0]?.animation.startTime).toBe(0);
		expect(created[1]?.animation.startTime).toBe(-800);
	});

	it("attaches to indicators mounted later and cancels when they unmount or lose the class", async () => {
		uninstall = installLiveAnimations();
		const dot = mount("vetta-live-dot");
		const label = mount("todo-label-sheen");
		await flush();
		expect(created.map((entry) => entry.element)).toEqual([dot, label]);

		dot.remove();
		label.className = "";
		await flush();
		expect(created[0]?.animation.cancel).toHaveBeenCalledTimes(1);
		expect(created[1]?.animation.cancel).toHaveBeenCalledTimes(1);

		// 完成态换回进行态：按新类名重新挂上。
		label.className = "todo-label-sheen";
		await flush();
		expect(created).toHaveLength(3);
		expect(created[2]?.element).toBe(label);
	});

	it("only animates compositor-friendly properties and starts every indicator in its resting look", () => {
		for (const selector of LIVE_ANIMATION_SELECTORS) mount(selector.replace(/^\./, "").replace(/\./g, " "));
		uninstall = installLiveAnimations();
		expect(created).toHaveLength(LIVE_ANIMATION_SELECTORS.length);
		for (const { animation } of created) {
			for (const frame of animation.keyframes) {
				const properties = Object.keys(frame).filter((key) => key !== "offset");
				expect(properties.every((key) => key === "opacity" || key === "transform")).toBe(true);
			}
		}
	});

	it("does nothing when the user prefers reduced motion", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }));
		mount("processing-shimmer");
		uninstall = installLiveAnimations();
		expect(created).toHaveLength(0);
	});

	it("cancels everything it created on uninstall", () => {
		mount("processing-shimmer");
		uninstall = installLiveAnimations();
		uninstall();
		uninstall = undefined;
		expect(created[0]?.animation.cancel).toHaveBeenCalledTimes(1);
	});
});
