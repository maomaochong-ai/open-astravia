/**
 * 产品故事：左侧时间线驱动右侧 sticky stage 切换
 * - IntersectionObserver 监听时间线 item，判断哪个最可见
 * - 同时支持点击切换和滚动切换
 */
export function initStory() {
	const items = document.querySelectorAll<HTMLElement>(".story__tl-item");
	const mocks = document.querySelectorAll<HTMLElement>(".story__mock");
	if (items.length === 0 || mocks.length === 0) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (reduceMotion) {
		items.forEach((i) => i.classList.add("is-active"));
		mocks.forEach((m) => m.classList.add("is-active"));
		return;
	}

	function activate(index: number) {
		items.forEach((el, i) => {
			const on = i === index;
			el.classList.toggle("is-active", on);
			el.setAttribute("aria-selected", on ? "true" : "false");
		});
		mocks.forEach((el, i) => el.classList.toggle("is-active", i === index));
	}

	// 点击切换
	items.forEach((el) => {
		el.addEventListener("click", () => {
			const idx = Number(el.dataset.storyIndex);
			if (!Number.isNaN(idx)) activate(idx);
		});
	});

	// IntersectionObserver 驱动滚动切换
	let activeIdx = 0;
	const io = new IntersectionObserver(
		(entries) => {
			// 找到可见比例最高的 item
			let bestRatio = 0;
			let bestIdx = activeIdx;
			for (const e of entries) {
				if (e.intersectionRatio > bestRatio) {
					bestRatio = e.intersectionRatio;
					bestIdx = Number((e.target as HTMLElement).dataset.storyIndex);
				}
			}
			if (bestIdx !== activeIdx && bestRatio > 0.25) {
				activeIdx = bestIdx;
				activate(bestIdx);
			}
		},
		{
			threshold: [0, 0.25, 0.5, 0.75, 1],
			rootMargin: "-20% 0px -20% 0px",
		},
	);

	items.forEach((el) => io.observe(el));

	// 初始状态
	activate(0);
}
