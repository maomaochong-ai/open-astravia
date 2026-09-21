/**
 * 窗口不在前台（失焦，或整页不可见）时，暂停页面里所有「无限循环」的动画，回到前台再恢复。
 *
 * macOS 主窗口带毛玻璃，页面每出一帧系统都要整窗重新合成；一个 4px 的脉冲点放着不管，
 * 就能让没人看的窗口长期占几成 GPU。无限动画只表达「还在进行」，窗口不在前台时停掉
 * 不丢信息——文字、进度这类真实内容不走动画，照常更新。
 *
 * 只动 iterations 为 Infinity 的动画：入场/退场这类有限动画一旦被暂停，元素会卡在
 * 起始帧（常常是 opacity: 0），失焦期间弹出的提示就再也看不见了。
 *
 * 覆盖 CSS 动画与 Web Animations；motion 用 rAF 逐帧改写样式的那一类拿不到句柄，
 * 需要组件自己处理。确实要在后台继续动的元素，标上 data-animate-when-inactive。
 */

const KEEP_ATTRIBUTE = "data-animate-when-inactive";
const ROOT_ATTRIBUTE = "data-window-active";
/** 失焦期间新挂载的无限动画靠定期补扫兜住；间隔只影响「多久后停下」，不影响正确性。 */
const RESCAN_INTERVAL_MS = 2000;

function isWindowActive(): boolean {
	return document.visibilityState === "visible" && document.hasFocus();
}

function isInfinite(animation: Animation): boolean {
	return animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY;
}

function isKept(animation: Animation): boolean {
	// 伪元素动画的 target 是宿主元素，同样适用。
	const target = (animation.effect as KeyframeEffect | null)?.target;
	return target instanceof Element && target.closest(`[${KEEP_ATTRIBUTE}]`) !== null;
}

/** 安装后立即按当前状态生效；返回卸载函数（恢复被本模块暂停的动画）。 */
export function installInactiveWindowAnimationPause(): () => void {
	// 只恢复自己停掉的：别处主动 pause 的动画不该被这里放出来。
	const pausedByUs = new Set<Animation>();
	let rescanTimer: number | null = null;

	const pauseInfiniteAnimations = () => {
		for (const animation of document.getAnimations()) {
			if (animation.playState !== "running" || !isInfinite(animation) || isKept(animation)) continue;
			animation.pause();
			pausedByUs.add(animation);
		}
	};

	const resumeAnimations = () => {
		for (const animation of pausedByUs) {
			if (animation.playState === "paused") animation.play();
		}
		pausedByUs.clear();
	};

	const sync = () => {
		const active = isWindowActive();
		document.documentElement.setAttribute(ROOT_ATTRIBUTE, String(active));
		if (active) {
			if (rescanTimer !== null) {
				window.clearInterval(rescanTimer);
				rescanTimer = null;
			}
			resumeAnimations();
			return;
		}
		pauseInfiniteAnimations();
		if (rescanTimer === null) {
			rescanTimer = window.setInterval(pauseInfiniteAnimations, RESCAN_INTERVAL_MS);
		}
	};

	window.addEventListener("focus", sync);
	window.addEventListener("blur", sync);
	document.addEventListener("visibilitychange", sync);
	sync();

	return () => {
		window.removeEventListener("focus", sync);
		window.removeEventListener("blur", sync);
		document.removeEventListener("visibilitychange", sync);
		if (rescanTimer !== null) window.clearInterval(rescanTimer);
		resumeAnimations();
		document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
	};
}
