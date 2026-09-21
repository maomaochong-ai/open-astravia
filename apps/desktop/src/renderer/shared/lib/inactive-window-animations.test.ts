// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installInactiveWindowAnimationPause, PAUSED_ATTRIBUTE } from "./inactive-window-animations";

interface FakeAnimation {
	/** 只有 CSS 动画才有这个字段；脚本创建的 Web Animations 没有。 */
	animationName?: string;
	playState: "running" | "paused";
	effect: { getComputedTiming: () => { iterations: number }; target?: Element };
	pause: ReturnType<typeof vi.fn>;
	play: ReturnType<typeof vi.fn>;
}

function fakeAnimation(
	iterations: number,
	options: { css?: Element; target?: Element; playState?: FakeAnimation["playState"] } = {},
): FakeAnimation {
	const animation: FakeAnimation = {
		animationName: options.css ? "spin" : undefined,
		playState: options.playState ?? "running",
		effect: { getComputedTiming: () => ({ iterations }), target: options.css ?? options.target },
		pause: vi.fn(() => {
			animation.playState = "paused";
		}),
		play: vi.fn(() => {
			animation.playState = "running";
		}),
	};
	return animation;
}

function mount(): HTMLElement {
	const element = document.createElement("span");
	document.body.appendChild(element);
	return element;
}

let animations: FakeAnimation[] = [];
let uninstall: (() => void) | undefined;

function setWindowFocused(focused: boolean): void {
	vi.spyOn(document, "hasFocus").mockReturnValue(focused);
	window.dispatchEvent(new Event(focused ? "focus" : "blur"));
}

beforeEach(() => {
	vi.useFakeTimers();
	animations = [];
	// jsdom 没有 Web Animations；这里只关心本模块对动画与宿主元素做了什么。
	Object.defineProperty(document, "getAnimations", { configurable: true, value: () => animations });
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
	uninstall?.();
	uninstall = undefined;
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("用户切到别的应用后，转圈图标停下，切回来后继续", () => {
	const icon = mount();
	animations = [fakeAnimation(Number.POSITIVE_INFINITY, { css: icon })];
	uninstall = installInactiveWindowAnimationPause();
	expect(icon.hasAttribute(PAUSED_ATTRIBUTE)).toBe(false);

	setWindowFocused(false);
	expect(icon.hasAttribute(PAUSED_ATTRIBUTE)).toBe(true);
	expect(document.documentElement.getAttribute("data-window-active")).toBe("false");

	setWindowFocused(true);
	expect(icon.hasAttribute(PAUSED_ATTRIBUTE)).toBe(false);
	expect(document.documentElement.getAttribute("data-window-active")).toBe("true");
});

it("任务期间切出去再切回来，任务停止后转圈图标不会永远转下去", () => {
	// Chromium 里 CSS 动画一旦被脚本 pause()/play() 过，就不再随样式移除而取消，
	// 会脱离样式一直转。所以对 CSS 动画只能用样式暂停，绝不能碰它的播放接口。
	const icon = mount();
	const spinner = fakeAnimation(Number.POSITIVE_INFINITY, { css: icon });
	animations = [spinner];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);
	setWindowFocused(true);

	expect(spinner.pause).not.toHaveBeenCalled();
	expect(spinner.play).not.toHaveBeenCalled();
});

it("脚本创建的无限动画同样会停下并恢复", () => {
	const scripted = fakeAnimation(Number.POSITIVE_INFINITY, { target: mount() });
	animations = [scripted];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);
	expect(scripted.playState).toBe("paused");

	setWindowFocused(true);
	expect(scripted.playState).toBe("running");
});

it("窗口失焦时弹出的提示仍能播完入场动画", () => {
	const toast = mount();
	const enter = fakeAnimation(1, { css: toast });
	animations = [enter];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);

	expect(toast.hasAttribute(PAUSED_ATTRIBUTE)).toBe(false);
	expect(enter.pause).not.toHaveBeenCalled();
});

it("失焦期间新出现的无限动画也会被停下", () => {
	uninstall = installInactiveWindowAnimationPause();
	setWindowFocused(false);

	const lateIcon = mount();
	animations = [fakeAnimation(Number.POSITIVE_INFINITY, { css: lateIcon })];
	vi.advanceTimersByTime(2000);

	expect(lateIcon.hasAttribute(PAUSED_ATTRIBUTE)).toBe(true);
});

it("别处主动暂停的脚本动画，回到前台时不会被放出来", () => {
	const pausedElsewhere = fakeAnimation(Number.POSITIVE_INFINITY, { target: mount(), playState: "paused" });
	animations = [pausedElsewhere];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);
	setWindowFocused(true);

	expect(pausedElsewhere.play).not.toHaveBeenCalled();
});

it("标了 data-animate-when-inactive 的元素在后台继续动", () => {
	const host = mount();
	host.setAttribute("data-animate-when-inactive", "");
	const child = document.createElement("span");
	host.appendChild(child);
	animations = [fakeAnimation(Number.POSITIVE_INFINITY, { css: child })];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);

	expect(child.hasAttribute(PAUSED_ATTRIBUTE)).toBe(false);
});
