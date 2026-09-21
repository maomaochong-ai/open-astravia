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
 * CSS 动画一律用样式暂停（给宿主元素打标记，由 styles.css 里的规则设
 * animation-play-state），**绝不能调它的 pause()/play()**：Chromium 里 CSS 动画一旦被
 * 脚本碰过，就不再随 animation-name 的移除而取消——任务跑完、转圈图标换成普通图标后，
 * 那段动画会脱离样式永远转下去，反而造出一个常驻动画（实测确认过）。
 * 脚本创建的 Web Animations 没有这层归属问题，直接 pause()/play()。
 *
 * motion 用 rAF 逐帧改写样式的那一类拿不到句柄，需要组件自己处理。
 * 确实要在后台继续动的元素，标上 data-animate-when-inactive。
 */

const KEEP_ATTRIBUTE = "data-animate-when-inactive";
const ROOT_ATTRIBUTE = "data-window-active";
/** 与 styles.css 里那条 animation-play-state 规则对应。 */
export const PAUSED_ATTRIBUTE = "data-inactive-paused";
/** 失焦期间新挂载的无限动画靠定期补扫兜住；间隔只影响「多久后停下」，不影响正确性。 */
const RESCAN_INTERVAL_MS = 2000;

function isWindowActive(): boolean {
	return document.visibilityState === "visible" && document.hasFocus();
}

function isInfinite(animation: Animation): boolean {
	return animation.effect?.getComputedTiming().iterations === Number.POSITIVE_INFINITY;
}

/** 伪元素动画的 target 是宿主元素，标记打在宿主上同样管用。 */
function targetOf(animation: Animation): Element | null {
	const target = (animation.effect as KeyframeEffect | null)?.target;
	return target instanceof Element ? target : null;
}

function isCssAnimation(animation: Animation): boolean {
	return typeof (animation as CSSAnimation).animationName === "string";
}

/** 安装后立即按当前状态生效；返回卸载函数（恢复被本模块暂停的动画）。 */
export function installInactiveWindowAnimationPause(): () => void {
	// 只恢复自己停掉的：别处主动暂停的动画不该被这里放出来。
	const markedElements = new Set<Element>();
	const pausedScriptAnimations = new Set<Animation>();
	let rescanTimer: number | null = null;

	const pauseInfiniteAnimations = () => {
		for (const animation of document.getAnimations()) {
			if (animation.playState !== "running" || !isInfinite(animation)) continue;
			const target = targetOf(animation);
			if (target?.closest(`[${KEEP_ATTRIBUTE}]`)) continue;
			if (isCssAnimation(animation)) {
				if (!target) continue;
				target.setAttribute(PAUSED_ATTRIBUTE, "");
				markedElements.add(target);
			} else {
				animation.pause();
				pausedScriptAnimations.add(animation);
			}
		}
	};

	const resumeAnimations = () => {
		for (const element of markedElements) element.removeAttribute(PAUSED_ATTRIBUTE);
		markedElements.clear();
		for (const animation of pausedScriptAnimations) {
			if (animation.playState === "paused") animation.play();
		}
		pausedScriptAnimations.clear();
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
