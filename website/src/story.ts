/**
 * 产品故事：Scroll-driven 动画
 * 滚动进度驱动：左侧文案切换 + 右侧 5 个 HTML Mock View 切换。
 * 每个 step 切换时，给对应 view 加 is-active class 触发 CSS 动画。
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

	// Step → 侧边栏高亮项映射（data-nav attribute）
	const NAV_BY_STEP: Record<number, string> = {
		0: "chat", // 新会话
		1: "chat", // 思考中（同 chat）
		2: "chat", // 工具执行（同 chat）
		3: "chat", // 结果（同 chat）
		4: "abilities", // 能力面板
	};

	const TITLES_BY_STEP: Record<number, string> = {
		0: "星轨 Astravia · 会话工作区",
		1: "星轨 Astravia · 会话工作区",
		2: "星轨 Astravia · 会话工作区",
		3: "星轨 Astravia · 会话工作区",
		4: "星轨 Astravia · 能力",
	};

	// 当前 step，用于去抖
	let currentStep = -1;

	function updateUI(index: number) {
		if (index === currentStep) return;
		currentStep = index;

		// 左侧圆点 + 文案
		for (let i = 0; i < stepCount; i++) {
			const isActive = i === index;
			dots[i].classList.toggle("is-active", isActive);
			dots[i].setAttribute("aria-current", isActive ? "step" : "false");
			copies[i].classList.toggle("is-active", isActive);
		}

		// 右侧 Mock View：隐藏所有 → 激活当前
		for (const view of views) {
			const viewStep = Number(view.dataset.step);
			view.classList.toggle("is-active", viewStep === index);
			// 重置动画（移除再添加 class），让每次切回都触发动画
			if (viewStep === index) {
				view.classList.remove("is-animating");
				// 强制 reflow 让动画重置
				void view.offsetWidth;
				view.classList.add("is-animating");
			}
		}

		// 侧边栏高亮切换
		const activeNav = NAV_BY_STEP[index];
		for (const item of sidebarItems) {
			item.classList.toggle("am-nav-item--active", item.dataset.nav === activeNav);
		}

		// 窗口标题更新
		if (windowTitle) windowTitle.textContent = TITLES_BY_STEP[index] ?? "星轨 Astravia";
	}

	// 滚动进度 → step index
	function progressToStep(progress: number): number {
		return Math.min(stepCount - 1, Math.max(0, Math.floor(progress * stepCount)));
	}

	if (reduceMotion) {
		// 无动画：直接在 IntersectionObserver 触发时显示第一个 step
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

	// 滚动驱动（fallback：纯 JS）
	let ticking = false;
	const onScroll = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			const rect = section.getBoundingClientRect();
			const viewport = window.innerHeight;
			const progress = Math.min(1, Math.max(0, (viewport * 0.5 - rect.top) / Math.max(1, rect.height)));

			// 进度填充条
			fill.style.transform = `translateX(-50%) scaleY(${progress})`;

			updateUI(progressToStep(progress));
			ticking = false;
		});
	};

	window.addEventListener("scroll", onScroll, { passive: true });
	window.addEventListener("resize", onScroll);
	onScroll();

	// 点击步骤点：平滑滚动
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
