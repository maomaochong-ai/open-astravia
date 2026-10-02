/**
 * 产品故事：IntersectionObserver 触发每个 node 动画
 * 每个 node 独立：进入视口 → is-visible → CSS transition 播放
 */
export function initStory() {
	const nodes = document.querySelectorAll<HTMLElement>(".story__node");
	if (nodes.length === 0) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (reduceMotion) {
		nodes.forEach((n) => n.classList.add("is-visible"));
		return;
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					entry.target.classList.add("is-visible");
					io.unobserve(entry.target);
				}
			}
		},
		{ threshold: 0.2, rootMargin: "0px 0px -80px 0px" },
	);

	nodes.forEach((n) => io.observe(n));
}
