/**
 * 产品故事：Scroll-driven 动画
 * 4 步故事：对话工作区 → 设计面板 → 自动化 → 能力
 * 滚动进度驱动左侧文案切换 + 右侧 HTML Mock View 切换。
 */

export function initStory() {
	const section = document.querySelector<HTMLElement>("#story");
	const fill = document.querySelector<HTMLElement>("[data-story-progress]");
	const dots = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-story-dot]"));
	const copies = Array.from(document.querySelectorAll<HTMLElement>("[data-story-copy]"));
	const views = Array.from(document.querySelectorAll<HTMLElement>(".am-view"));
	const sidebarItems = Array.from(document.querySelectorAll<HTMLElement>(".am-nav-item"));
	const windowTitle = document.getElementById("storyWindowTitle");

	if (!section || !fill || dots.length === 0 || copies.length !== dots.length || views.length !== dots.length) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const stepCount = dots.length;

	// Step → sidebar nav highlight
	const NAV_BY_STEP: Record<number, string> = {
		0: "chat",
		1: "design",
		2: "automation",
		3: "abilities",
	};

	const TITLES_BY_STEP: Record<number, string> = {
		0: "星轨 Astravia · 对话工作区",
		1: "星轨 Astravia · 设计",
		2: "星轨 Astravia · 自动化",
		3: "星轨 Astravia · 能力",
	};

	let currentStep = -1;

	function updateUI(index: number) {
		if (index === currentStep) return;
		currentStep = index;

		// 左侧 dot + 文案
		for (let i = 0; i < stepCount; i++) {
			const isActive = i === index;
			dots[i].classList.toggle("is-active", isActive);
			dots[i].setAttribute("aria-current", isActive ? "step" : "false");
			copies[i].classList.toggle("is-active", isActive);
		}

		// 右侧 Mock View
		for (const view of views) {
			const viewStep = Number(view.dataset.step);
			view.classList.toggle("is-active", viewStep === index);
			if (viewStep === index) {
				view.classList.remove("is-animating");
				void view.offsetWidth; // reflow 重置动画
				view.classList.add("is-animating");
			}
		}

		// 侧边栏高亮
		const activeNav = NAV_BY_STEP[index];
		for (const item of sidebarItems) {
			item.classList.toggle("am-nav-item--active", item.dataset.nav === activeNav);
		}

		// 窗口标题
		if (windowTitle) windowTitle.textContent = TITLES_BY_STEP[index] ?? "星轨 Astravia";
	}

	function progressToStep(progress: number): number {
		return Math.min(stepCount - 1, Math.max(0, Math.floor(progress * stepCount)));
	}

	if (reduceMotion) {
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						updateUI(0);
						observer.disconnect();
						return;
					}
				}
			},
			{ threshold: 0.1 },
		);
		observer.observe(section);
		return;
	}

	let ticking = false;
	const onScroll = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			const rect = section.getBoundingClientRect();
			const viewport = window.innerHeight;
			const progress = Math.min(1, Math.max(0, (viewport * 0.5 - rect.top) / Math.max(1, rect.height)));

			fill.style.transform = `translateX(-50%) scaleY(${progress})`;
			updateUI(progressToStep(progress));
			ticking = false;
		});
	};

	window.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("resize", onScroll);
	onScroll();

	for (const dot of dots) {
		dot.addEventListener("click", () => {
			const index = Number(dot.dataset.storyDot ?? 0);
			const rect = section.getBoundingClientRect();
			const target = window.scrollY + rect.top + (index / (stepCount - 1)) * rect.height - window.innerHeight * 0.5;
			window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
			updateUI(index);
		});
	}
}
