/**
 * 「进行中」指示器的共享步进动画：呼吸文字、状态点、波纹、转弧。
 *
 * macOS 主窗口带毛玻璃，页面每出一帧系统都要整窗重合成；流式期间这些指示器若各自用平滑关键帧，
 * 每个都是 60fps，任意一个都能把 GPU 顶到几成。实测（Chromium 132）几种写法：
 * - opacity/transform 关键帧 + steps(16)：每秒画 12 帧，主线程≈0（合成器直接驱动）。
 * - 注册自定义属性做时钟：画帧同样 12/s，但 Blink 每帧都在主线程重算样式，挂在 :root 上时 300ms/s。
 * - 平滑曲线：70 帧/s。
 * 所以用 Web Animations API 给每个元素建 steps(16) 的 opacity/transform 动画，再把 startTime 锁到
 * 文档时间线原点：所有指示器同拍，整页每秒最多因此多出 10 帧，主线程零开销。
 *
 * 元素只需带登记表里的类名（theme-ui 组件保持纯声明），由本模块用 MutationObserver 挂上动画、
 * 卸载时取消。失焦暂停沿用 inactive-window-animations：脚本动画它会直接 pause()/play()。
 */

const PERIOD_MS = 1600;
const STEPS = 16;

interface LiveAnimationSpec {
	readonly keyframes: Keyframe[];
	/** 相位偏移（周期的比例），第二圈波纹错开半周用。 */
	readonly offset?: number;
}

/** 类名 → 动画。相位 0 是「亮」的静止态：减少动态偏好时元素停在首帧就是正常外观。 */
const REGISTRY: ReadonlyArray<readonly [selector: string, spec: LiveAnimationSpec]> = [
	// 折叠头「处理中」文字：1 ↔ 0.58 呼吸。
	[".processing-shimmer", { keyframes: [{ opacity: 1 }, { opacity: 0.58 }, { opacity: 1 }] }],
	// 运行中的工具名：1 ↔ 0.55 呼吸。
	[".tool-call-shimmer-text", { keyframes: [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }] }],
	// 运行中的小圆点：1 ↔ 0.4 呼吸。
	[".vetta-live-dot", { keyframes: [{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }] }],
	// 进行中待办标签：1 ↔ 0.6 呼吸。
	[".todo-label-sheen", { keyframes: [{ opacity: 1 }, { opacity: 0.6 }, { opacity: 1 }] }],
	// 进行中待办的转弧：16 步一圈。
	[".todo-marker-spin", { keyframes: [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }] }],
	// 活动状态点：光晕在前 70% 相位扩散淡出、后 30% 停住；核心点同拍呼吸。
	[
		".activity-dot-halo",
		{
			keyframes: [
				{ transform: "scale(0.7)", opacity: 0.55, offset: 0 },
				{ transform: "scale(2.1)", opacity: 0, offset: 0.7 },
				{ transform: "scale(2.1)", opacity: 0, offset: 1 },
			],
		},
	],
	[".activity-dot-core", { keyframes: [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }] }],
	// 发送按钮的两圈波纹：由内向外扩散淡出，第二圈错开半周。
	[
		".send-button-ripple-1",
		{
			keyframes: [
				{ transform: "scale(1)", opacity: 0.55 },
				{ transform: "scale(1.35)", opacity: 0 },
			],
		},
	],
	[
		".send-button-ripple-2",
		{
			keyframes: [
				{ transform: "scale(1)", opacity: 0.55 },
				{ transform: "scale(1.35)", opacity: 0 },
			],
			offset: 0.5,
		},
	],
];

const ANY_SELECTOR = REGISTRY.map(([selector]) => selector).join(", ");

export const LIVE_ANIMATION_SELECTORS: readonly string[] = REGISTRY.map(([selector]) => selector);

function prefersReducedMotion(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function specFor(element: Element): LiveAnimationSpec | undefined {
	for (const [selector, spec] of REGISTRY) if (element.matches(selector)) return spec;
	return undefined;
}

/** 安装后立即给页面上已有的指示器挂动画；返回卸载函数（取消本模块创建的动画）。 */
export function installLiveAnimations(root: ParentNode = document): () => void {
	const animations = new Map<Element, Animation>();

	const attach = (element: Element): void => {
		if (animations.has(element) || typeof element.animate !== "function") return;
		const spec = specFor(element);
		if (!spec) return;
		const animation = element.animate(spec.keyframes, {
			duration: PERIOD_MS,
			easing: `steps(${STEPS}, end)`,
			iterations: Number.POSITIVE_INFINITY,
		});
		// 锁到文档时间线原点：不管元素何时挂载，所有指示器都在同一步上换帧。
		animation.startTime = 0 - (spec.offset ?? 0) * PERIOD_MS;
		animations.set(element, animation);
	};

	const detach = (element: Element): void => {
		const animation = animations.get(element);
		if (!animation) return;
		animation.cancel();
		animations.delete(element);
	};

	const scan = (node: Node): void => {
		if (!(node instanceof Element)) return;
		attach(node);
		for (const element of node.querySelectorAll(ANY_SELECTOR)) attach(element);
	};

	const sweep = (node: Node): void => {
		if (!(node instanceof Element)) return;
		detach(node);
		for (const element of node.querySelectorAll(ANY_SELECTOR)) detach(element);
	};

	if (prefersReducedMotion()) return () => {};

	scan(root instanceof Element ? root : document.documentElement);

	const observer = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === "attributes") {
				const element = record.target;
				if (!(element instanceof Element)) continue;
				// 类名换掉（完成态去掉呼吸类）时取消旧动画，再按新类名判断要不要重挂。
				if (animations.has(element) && !specFor(element)) detach(element);
				else attach(element);
				continue;
			}
			for (const node of record.removedNodes) sweep(node);
			for (const node of record.addedNodes) scan(node);
		}
	});
	observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

	return () => {
		observer.disconnect();
		for (const element of [...animations.keys()]) detach(element);
	};
}
