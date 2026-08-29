/**
 * 产品故事：滚动驱动的步骤进度与切换
 * 独立模块，由 main.ts 引入。
 */

export function initStory() {
	const section = document.querySelector<HTMLElement>("#story");
	const fill = document.querySelector<HTMLElement>("[data-story-progress]");
	const dots = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-story-dot]"));
	const copies = Array.from(document.querySelectorAll<HTMLElement>("[data-story-copy]"));
	const screens = Array.from(document.querySelectorAll<HTMLElement>("[data-story-screen]"));
	const navs = Array.from(document.querySelectorAll<HTMLElement>("[data-story-nav]"));
	// 步骤 → 侧边栏导航项映射（0 新会话 · 2 批量任务 · 3 知识库）
	const navByStep = [0, 0, 2, 0, 3];
	if (!section || !fill || dots.length === 0 || copies.length !== dots.length || screens.length !== dots.length)
		return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const stepCount = dots.length;
	let active = 0;
	let ticking = false;

	const setStep = (index: number) => {
		if (index === active) return;
		active = index;
		for (let i = 0; i < stepCount; i++) {
			const isActive = i === index;
			dots[i].classList.toggle("is-active", isActive);
			dots[i].setAttribute("aria-current", isActive ? "step" : "false");
			copies[i].classList.toggle("is-active", isActive);
			screens[i].classList.toggle("is-active", isActive);
		}
		for (const nav of navs) {
			nav.classList.toggle("is-active", Number(nav.dataset.storyNav) === navByStep[index]);
		}
	};

	const update = () => {
		const rect = section.getBoundingClientRect();
		const viewport = window.innerHeight;
		const progress = Math.min(1, Math.max(0, (viewport * 0.5 - rect.top) / Math.max(1, rect.height)));
		fill.style.transform = `translateX(-50%) scaleY(${progress})`;
		const index = Math.min(stepCount - 1, Math.max(0, Math.round(progress * (stepCount - 1))));
		setStep(index);
	};

	const onScroll = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			update();
			ticking = false;
		});
	};

	// 点击步骤点：平滑滚动到对应位置
	for (const dot of dots) {
		dot.addEventListener("click", () => {
			const index = Number(dot.dataset.storyDot ?? 0);
			const rect = section.getBoundingClientRect();
			const target = window.scrollY + rect.top + (index / (stepCount - 1)) * rect.height - window.innerHeight * 0.5;
			window.scrollTo({ top: Math.max(0, target), behavior: reduceMotion ? "auto" : "smooth" });
		});
	}

	if (reduceMotion) {
		// 动效降级：文案已在 CSS 中静态展开，进度直接填满
		fill.style.transform = "translateX(-50%) scaleY(1)";
		return;
	}

	update();
	window.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("resize", onScroll);
}
