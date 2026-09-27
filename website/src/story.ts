/**
 * 产品故事：Scroll-driven 动画
 * 滚动进度直接驱动 SVG 元素和左侧文案的切换，动画与滚动速度完全同步。
 */

export function initStory() {
	const section = document.querySelector<HTMLElement>("#story");
	const fill = document.querySelector<HTMLElement>("[data-story-progress]");
	const dots = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-story-dot]"));
	const copies = Array.from(document.querySelectorAll<HTMLElement>("[data-story-copy]"));
	const svg = document.querySelector<SVGElement>(".story__svg");

	if (!section || !fill || dots.length === 0 || copies.length !== dots.length || !svg) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const stepCount = dots.length;

	// SVG 元素分组
	const msgUser = svg.querySelector<SVGElement>("[data-step='0']");
	const msgAssistant = svg.querySelector<SVGElement>("[data-step='1']");
	const msgTool = svg.querySelector<SVGElement>("[data-step='2']");
	const msgResult = svg.querySelector<SVGElement>("[data-step='3']");
	const highlights = Array.from(svg.querySelectorAll<SVGElement>("[data-step]"));
	const sidebarNavs = Array.from(svg.querySelectorAll<SVGElement>(".story__sidebar-nav"));
	const sidebarTexts = Array.from(svg.querySelectorAll<SVGTextElement>(".story__sidebar-text"));

	// 步骤 → 侧边栏导航项映射（0=新会话，1=新会话，2=批量任务，3=新会话，4=知识库）
	const navByStep = [0, 0, 2, 0, 3];

	// CSS scroll-timeline 支持检测
	const hasScrollTimeline = "ScrollTimeline" in window;

	if (hasScrollTimeline && !reduceMotion) {
		// 使用原生 CSS scroll-driven animation
		section.style.viewTimelineName = "--story-progress";
		section.style.viewTimelineAxis = "block";

		if (fill) {
			fill.style.animationName = "story-fill";
			fill.style.animationTimeline = "--story-progress";
			fill.style.animationRange = "contain 0% contain 100%";
			fill.style.animationFillMode = "both";
		}

		// SVG 元素随滚动渐入
		const svgSteps: [SVGElement | null, string][] = [
			[msgUser, "story-step-0"],
			[msgAssistant, "story-step-1"],
			[msgTool, "story-step-2"],
			[msgResult, "story-step-3"],
		];

		svgSteps.forEach(([el, name]) => {
			if (el) {
				el.style.animationName = name;
				el.style.animationTimeline = "--story-progress";
				el.style.animationFillMode = "both";
			}
		});

		// 注入 keyframes
		const styleSheet = document.createElement("style");
		styleSheet.textContent = `
			@keyframes story-fill {
				from { transform: translateX(-50%) scaleY(0); }
				to { transform: translateX(-50%) scaleY(1); }
			}
			@keyframes story-step-0 {
				0%, 10% { opacity: 1; }
				20%, 100% { opacity: 0.4; }
			}
			@keyframes story-step-1 {
				0%, 20% { opacity: 0; }
				25%, 30% { opacity: 1; }
				35%, 100% { opacity: 0.3; }
			}
			@keyframes story-step-2 {
				0%, 35% { opacity: 0; }
				40%, 50% { opacity: 1; }
				55%, 100% { opacity: 0.3; }
			}
			@keyframes story-step-3 {
				0%, 55% { opacity: 0; }
				60%, 75% { opacity: 1; }
				80%, 100% { opacity: 0.3; }
			}
		`;
		document.head.appendChild(styleSheet);

		// JS 只处理左侧文案和圆点的切换
		let ticking = false;
		const onScroll = () => {
			if (ticking) return;
			ticking = true;
			requestAnimationFrame(() => {
				const rect = section.getBoundingClientRect();
				const viewport = window.innerHeight;
				const progress = Math.min(1, Math.max(0, (viewport * 0.5 - rect.top) / Math.max(1, rect.height)));
				const index = Math.min(stepCount - 1, Math.max(0, Math.floor(progress * stepCount)));
				updateUI(index);
				ticking = false;
			});
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		onScroll();
	} else {
		// Fallback: 纯 JS 驱动
		let ticking = false;
		const onScroll = () => {
			if (ticking) return;
			ticking = true;
			requestAnimationFrame(() => {
				const rect = section.getBoundingClientRect();
				const viewport = window.innerHeight;
				const progress = Math.min(1, Math.max(0, (viewport * 0.5 - rect.top) / Math.max(1, rect.height)));
				fill.style.transform = `translateX(-50%) scaleY(${progress})`;
				const index = Math.min(stepCount - 1, Math.max(0, Math.floor(progress * stepCount)));
				updateUI(index);
				updateSVG(index, progress);
				ticking = false;
			});
		};

		const updateSVG = (_index: number, progress: number) => {
			const stepProgress = (progress * stepCount) % 1;
			const currentStep = Math.floor(progress * stepCount);

			// 每个元素在对应步骤渐入
			const opacities: Record<number, number> = {};
			for (let i = 0; i < stepCount; i++) {
				if (i < currentStep) {
					opacities[i] = 0.3; // 过去的步骤变淡
				} else if (i === currentStep) {
					opacities[i] = 0.3 + stepProgress * 0.7; // 当前步骤渐入
				} else {
					opacities[i] = 0; // 未来的步骤隐藏
				}
			}

			if (msgUser) msgUser.style.opacity = String(opacities[0] ?? 0);
			if (msgAssistant) msgAssistant.style.opacity = String(opacities[1] ?? 0);
			if (msgTool) msgTool.style.opacity = String(opacities[2] ?? 0);
			if (msgResult) msgResult.style.opacity = String(opacities[3] ?? 0);

			// 高亮框跟随当前步骤
			highlights.forEach((h) => {
				const step = Number(h.dataset.step);
				h.style.opacity = step === currentStep ? "1" : "0";
			});
		};

		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		onScroll();
	}

	function updateUI(index: number) {
		for (let i = 0; i < stepCount; i++) {
			const isActive = i === index;
			dots[i].classList.toggle("is-active", isActive);
			dots[i].setAttribute("aria-current", isActive ? "step" : "false");
			copies[i].classList.toggle("is-active", isActive);
		}
		// 更新 SVG 侧边栏高亮
		const activeNavIndex = navByStep[index];
		sidebarNavs.forEach((nav, i) => {
			if (i === activeNavIndex) {
				nav.setAttribute("fill", "#1e1e24");
				sidebarTexts[i].setAttribute("fill", "#7c8aff");
				sidebarTexts[i].setAttribute("font-weight", "500");
			} else {
				nav.setAttribute("fill", "transparent");
				sidebarTexts[i].setAttribute("fill", "#8e9199");
				sidebarTexts[i].setAttribute("font-weight", "400");
			}
		});
	}

	// 点击步骤点：平滑滚动到对应位置
	for (const dot of dots) {
		dot.addEventListener("click", () => {
			const index = Number(dot.dataset.storyDot ?? 0);
			const rect = section.getBoundingClientRect();
			const target = window.scrollY + rect.top + (index / (stepCount - 1)) * rect.height - window.innerHeight * 0.5;
			window.scrollTo({ top: Math.max(0, target), behavior: reduceMotion ? "auto" : "smooth" });
			// 点击后立即更新 UI
			updateUI(index);
		});
	}
}
