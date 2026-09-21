// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installInactiveWindowAnimationPause } from "./inactive-window-animations";

interface FakeAnimation {
	animationName?: string;
	cancelled?: boolean;
	playState: "running" | "paused" | "idle";
	effect: { getComputedTiming: () => { iterations: number }; target?: Element };
	pause: () => void;
	play: () => void;
	cancel: () => void;
}

function fakeAnimation(iterations: number, playState: FakeAnimation["playState"] = "running"): FakeAnimation {
	const animation: FakeAnimation = {
		playState,
		effect: { getComputedTiming: () => ({ iterations }) },
		pause: () => {
			animation.playState = "paused";
		},
		play: () => {
			animation.playState = "running";
		},
		cancel: () => {
			animation.playState = "idle";
			animation.cancelled = true;
		},
	};
	return animation;
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
	// jsdom 没有 Web Animations；这里只关心本模块对动画句柄做了什么。
	Object.defineProperty(document, "getAnimations", { configurable: true, value: () => animations });
	vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
	uninstall?.();
	uninstall = undefined;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("用户切到别的应用后，无限循环的动画停下，切回来后继续", () => {
	const spinner = fakeAnimation(Number.POSITIVE_INFINITY);
	animations = [spinner];
	uninstall = installInactiveWindowAnimationPause();
	expect(spinner.playState).toBe("running");

	setWindowFocused(false);
	expect(spinner.playState).toBe("paused");
	expect(document.documentElement.getAttribute("data-window-active")).toBe("false");

	setWindowFocused(true);
	expect(spinner.playState).toBe("running");
	expect(document.documentElement.getAttribute("data-window-active")).toBe("true");
});

it("窗口失焦时弹出的提示仍能播完入场动画", () => {
	const toastEnter = fakeAnimation(1);
	animations = [toastEnter];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);

	expect(toastEnter.playState).toBe("running");
});

it("失焦期间新出现的无限动画也会被停下", () => {
	uninstall = installInactiveWindowAnimationPause();
	setWindowFocused(false);

	const lateSpinner = fakeAnimation(Number.POSITIVE_INFINITY);
	animations = [lateSpinner];
	vi.advanceTimersByTime(2000);

	expect(lateSpinner.playState).toBe("paused");
});

it("别处主动暂停的动画，回到前台时不会被放出来", () => {
	const pausedElsewhere = fakeAnimation(Number.POSITIVE_INFINITY, "paused");
	animations = [pausedElsewhere];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);
	setWindowFocused(true);

	expect(pausedElsewhere.playState).toBe("paused");
});

it("标了 data-animate-when-inactive 的元素在后台继续动", () => {
	const host = document.createElement("div");
	host.setAttribute("data-animate-when-inactive", "");
	const child = document.createElement("span");
	host.appendChild(child);
	document.body.appendChild(host);
	const kept = fakeAnimation(Number.POSITIVE_INFINITY);
	kept.effect.target = child;
	animations = [kept];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);

	expect(kept.playState).toBe("running");
	host.remove();
});

it("失焦期间转圈图标已经换成普通图标时，回到前台不会让它重新转起来", () => {
	const icon = document.createElement("span");
	icon.style.animationName = "spin";
	document.body.appendChild(icon);
	const spinner = fakeAnimation(Number.POSITIVE_INFINITY);
	spinner.animationName = "spin";
	spinner.effect.target = icon;
	animations = [spinner];
	uninstall = installInactiveWindowAnimationPause();

	setWindowFocused(false);
	expect(spinner.playState).toBe("paused");
	// 任务在后台跑完，图标不再声明转圈动画。
	icon.style.animationName = "none";
	setWindowFocused(true);

	expect(spinner.playState).toBe("idle");
	expect(spinner.cancelled).toBe(true);
	icon.remove();
});

it("失焦期间转圈图标换成普通图标后，图标不会被冻在转到一半的角度上", () => {
	const icon = document.createElement("span");
	icon.style.animationName = "spin";
	document.body.appendChild(icon);
	const spinner = fakeAnimation(Number.POSITIVE_INFINITY);
	spinner.animationName = "spin";
	spinner.effect.target = icon;
	animations = [spinner];
	uninstall = installInactiveWindowAnimationPause();
	setWindowFocused(false);

	icon.style.animationName = "none";
	vi.advanceTimersByTime(2000);

	expect(spinner.cancelled).toBe(true);
	icon.remove();
});
