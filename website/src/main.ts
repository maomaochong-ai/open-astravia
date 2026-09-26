/**
 * 星轨 Astravia 官网交互
 * 纯 TypeScript，无运行时依赖。
 */

import "./style.css";

import { initStory } from "./story";

const NAV = document.querySelector<HTMLElement>(".nav");
const NAV_TOGGLE = document.querySelector<HTMLButtonElement>("#navToggle");
const NAV_LINKS = document.querySelector<HTMLElement>("#navLinks");
const THEME_TOGGLE = document.querySelector<HTMLButtonElement>("#themeToggle");
const THEME_KEY = "astravia-theme";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getCurrentTheme(): Theme {
	const stored = document.documentElement.dataset.theme;
	return stored === "light" || stored === "dark" ? stored : getSystemTheme();
}

function applyThemeToggleState(theme: Theme) {
	if (!THEME_TOGGLE) return;
	THEME_TOGGLE.classList.toggle("is-light", theme === "light");
	THEME_TOGGLE.classList.toggle("is-dark", theme === "dark");
	THEME_TOGGLE.setAttribute("aria-pressed", String(theme === "dark"));
	THEME_TOGGLE.setAttribute("aria-label", theme === "dark" ? "切换到浅色模式" : "切换到深色模式");
	document
		.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
		?.setAttribute("content", theme === "dark" ? "#08080a" : "#fbfbfd");
}

/* 深浅主题：点击切换并记忆；默认浅色（Apple 纸感风），仅存过 dark 才回暗色 */
function initThemeToggle() {
	if (!THEME_TOGGLE) return;
	applyThemeToggleState(getCurrentTheme());
	THEME_TOGGLE.addEventListener("click", () => {
		const next: Theme = getCurrentTheme() === "dark" ? "light" : "dark";
		document.documentElement.classList.add("theme-transition");
		window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 350);
		document.documentElement.dataset.theme = next;
		localStorage.setItem(THEME_KEY, next);
		applyThemeToggleState(next);
	});
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
		// 用户未手动选择过时，图标状态跟随系统切换
		if (!document.documentElement.dataset.theme) {
			applyThemeToggleState(event.matches ? "dark" : "light");
		}
	});
}

/* 导航：滚动后出现底部分隔线 */
function initNavScroll() {
	if (!NAV) return;
	const onScroll = () => {
		NAV.classList.toggle("is-scrolled", window.scrollY > 8);
	};
	onScroll();
	window.addEventListener("scroll", onScroll, { passive: true });
}

/* 移动端菜单 */
function initNavToggle() {
	if (!NAV || !NAV_TOGGLE || !NAV_LINKS) return;
	NAV_TOGGLE.addEventListener("click", () => {
		const open = NAV.classList.toggle("open");
		NAV_TOGGLE.setAttribute("aria-expanded", String(open));
		NAV_TOGGLE.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
	});
	// 点击菜单项后收起
	NAV_LINKS.addEventListener("click", (event) => {
		const target = event.target as HTMLElement | null;
		if (target?.tagName === "A") {
			NAV.classList.remove("open");
			NAV_TOGGLE.setAttribute("aria-expanded", "false");
			NAV_TOGGLE.setAttribute("aria-label", "打开菜单");
		}
	});
	// 按 Esc 关闭菜单并把焦点还给开关
	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || !NAV.classList.contains("open")) return;
		NAV.classList.remove("open");
		NAV_TOGGLE.setAttribute("aria-expanded", "false");
		NAV_TOGGLE.setAttribute("aria-label", "打开菜单");
		NAV_TOGGLE.focus();
	});
}

/* 滚动显现 */
function initReveal() {
	const items = document.querySelectorAll<HTMLElement>(".reveal");
	if (items.length === 0) return;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		for (const item of items) item.classList.add("is-visible");
		return;
	}
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					entry.target.classList.add("is-visible");
					observer.unobserve(entry.target);
				}
			}
		},
		{ threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
	);
	for (const item of items) observer.observe(item);
}

/* 当前区块高亮导航项 */
function initActiveNav() {
	const links = document.querySelectorAll<HTMLAnchorElement>(".nav__links a[data-nav]");
	if (links.length === 0) return;
	const sections: Array<{ id: string; link: HTMLAnchorElement }> = [];
	for (const link of links) {
		const id = link.dataset.nav;
		if (!id) continue;
		const section = document.getElementById(id);
		if (section) sections.push({ id, link });
	}
	if (sections.length === 0) return;
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				for (const { link } of sections) link.classList.remove("is-active");
				const current = sections.find(({ id }) => id === entry.target.id);
				current?.link.classList.add("is-active");
			}
		},
		{ rootMargin: "-40% 0px -55% 0px" },
	);
	for (const { id } of sections) {
		const section = document.getElementById(id);
		if (section) observer.observe(section);
	}
}

/* 平滑滚动修复闪烁 */
function initSmoothScroll() {
	const links = document.querySelectorAll<HTMLAnchorElement>('.nav__links a[href^="#"]');
	for (const link of links) {
		link.addEventListener("click", (event) => {
			const href = link.getAttribute("href");
			if (!href || href === "#") return;
			const target = document.querySelector<HTMLElement>(href);
			if (!target) return;
			event.preventDefault();
			target.scrollIntoView({ behavior: "smooth", block: "start" });
			// 更新 URL 但不触发跳转
			history.pushState(null, "", href);
		});
	}
}

/* 页脚年份 */
function initYear() {
	const year = document.querySelector<HTMLElement>("#year");
	if (year) year.textContent = String(new Date().getFullYear());
}

/* FAQ 展开/收起（收起动画需延迟移除 open） */
function initFaq() {
	const items = document.querySelectorAll<HTMLDetailsElement>(".faq__item");
	items.forEach((item) => {
		const body = item.querySelector<HTMLElement>(".faq__body");
		const summary = item.querySelector("summary");
		if (!body || !summary) return;

		summary.addEventListener("click", (event) => {
			event.preventDefault();
			if (item.open) {
				body.style.gridTemplateRows = "0fr";
				body.addEventListener("transitionend", () => item.removeAttribute("open"), { once: true });
			} else {
				item.setAttribute("open", "");
				requestAnimationFrame(() => {
					body.style.gridTemplateRows = "1fr";
				});
			}
		});
	});
}

/* 下载：按访问系统自动选中对应平台，支持手动切换 */
type DlOs = "macos" | "windows" | "linux";

const DL_OS_LABEL: Record<DlOs, string> = {
	macos: "macOS",
	windows: "Windows",
	linux: "Linux",
};

function detectOs(): DlOs | null {
	const ua = navigator.userAgent;
	if (/Mac|iPhone|iPad/.test(ua)) return "macos";
	if (/Windows/.test(ua)) return "windows";
	if (/Linux|X11|CrOS/.test(ua)) return "linux";
	return null;
}

function initDownload() {
	const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".dl-tab"));
	const panes = Array.from(document.querySelectorAll<HTMLElement>(".dl-pane"));
	if (tabs.length === 0) return;
	const detect = document.getElementById("dlDetect");
	const detectText = document.getElementById("dlDetectText");

	function show(os: DlOs, auto: boolean) {
		for (const tab of tabs) {
			const active = tab.dataset.os === os;
			tab.classList.toggle("is-active", active);
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
		}
		for (const pane of panes) {
			pane.hidden = pane.id !== `dlPane${os.charAt(0).toUpperCase()}${os.slice(1)}`;
		}
		if (detectText) {
			detectText.textContent = auto ? `已自动识别你的系统：${DL_OS_LABEL[os]}` : `已选择 ${DL_OS_LABEL[os]} 版`;
		}
	}

	for (const tab of tabs) {
		tab.addEventListener("click", () => {
			const os = tab.dataset.os;
			if (os === "macos" || os === "windows" || os === "linux") {
				detect?.removeAttribute("hidden");
				show(os, false);
			}
		});
	}

	const os = detectOs();
	if (os) {
		detect?.removeAttribute("hidden");
		show(os, true);
	}
}

initNavScroll();
initNavToggle();
initReveal();
initActiveNav();
initSmoothScroll();
initYear();
initThemeToggle();

initFaq();
initDownload();

initStory();

/* 下载底部基座装饰 */
function initConstellation() {
	const ICON = 48;
	const GAP = 10;
	const theater = document.querySelector<HTMLElement>(".download-theater");
	const topIcons = Array.from(document.querySelectorAll<HTMLElement>("#dlPlatforms .dl-platform-icon"));
	const svgEl = document.getElementById("dlConstellationSVG");
	const pEl = document.getElementById("dlPrimary");
	const toggle = document.getElementById("dlOthersToggle");
	const others = document.getElementById("dlOthers");
	if (!theater || topIcons.length === 0) return;

	// 隐藏 SVG 连线（纯装饰不需要）
	if (svgEl) svgEl.style.display = "none";

	function calcPositions() {
		if (!pEl || !theater) return [];
		const tRect = theater.getBoundingClientRect();
		const pRect = pEl.getBoundingClientRect();
		const othersRect = others?.getBoundingClientRect();

		// 基座位置：其他版本按钮下方 24px
		const baseY = (othersRect ? othersRect.bottom : pRect.bottom) - tRect.top + 24;
		const totalWidth = topIcons.length * ICON + (topIcons.length - 1) * GAP;
		const startX = (tRect.width - totalWidth) / 2;

		const positions: Array<{ x: number; y: number }> = [];
		for (let i = 0; i < topIcons.length; i++) {
			positions.push({
				x: startX + i * (ICON + GAP) + ICON / 2,
				y: baseY,
			});
		}
		return positions;
	}

	function start() {
		const positions = calcPositions();
		if (positions.length === 0) return;

		topIcons.forEach((el, i) => {
			const tx = positions[i].x - ICON / 2;
			const ty = positions[i].y - ICON / 2;

			// 从下方升起
			const sy = ty + 60 + Math.random() * 40;

			el.style.cssText = "";
			el.style.opacity = "0";
			el.style.position = "absolute";
			el.style.left = `${tx}px`;
			el.style.top = `${sy}px`;
			el.style.width = `${ICON}px`;
			el.style.height = `${ICON}px`;
			el.style.transform = `scale(0.8)`;

			const delay = i * 60;
			const riseDur = 400 + Math.round(Math.random() * 100);

			requestAnimationFrame(() => {
				setTimeout(() => {
					el.style.opacity = "0.4";
					el.style.transition = `top ${riseDur}ms cubic-bezier(0.16,1,0.3,1), transform ${riseDur}ms cubic-bezier(0.16,1,0.3,1), opacity 200ms ease`;
					el.style.top = `${ty}px`;
					el.style.transform = `scale(1)`;
				}, delay);
			});

			// hover 效果
			el.addEventListener("mouseenter", () => {
				el.style.transition = "transform 0.2s var(--ease), opacity 0.2s ease, box-shadow 0.2s ease";
				el.style.transform = `translateY(-4px) scale(1.08)`;
				el.style.opacity = "0.7";
				el.style.borderColor = "var(--accent)";
			});
			el.addEventListener("mouseleave", () => {
				el.style.transition = "transform 0.3s ease, opacity 0.3s ease, box-shadow 0.3s ease";
				el.style.transform = `scale(1)`;
				el.style.opacity = "0.4";
				el.style.borderColor = "";
			});
		});
	}

	// 平台检测高亮
	const ua = navigator.userAgent;
	const isMac = /Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
	const isWin = /Win/i.test(ua);
	const iconMap: Record<string, string> = { macos: "ollama", windows: "kimi", linux: "grok" };
	const platform = isMac && /ARM|arm64|aarch64/i.test(ua) ? "macos" : isMac ? "macos" : isWin ? "windows" : "linux";
	document.querySelectorAll(".dl-platform-icon").forEach((el) => {
		const htmlEl = el as HTMLElement;
		if (htmlEl.dataset.p === iconMap[platform]) {
			htmlEl.style.opacity = "0.6";
			htmlEl.style.borderColor = "var(--accent)";
		}
	});

	// 下载链接
	const dlPrimary = document.getElementById("dlPrimary") as HTMLAnchorElement;
	const dlPrimaryText = document.getElementById("dlPrimaryText");
	const dlPrimaryVersion = document.getElementById("dlPrimaryVersion");
	if (isMac && /ARM|arm64|aarch64/i.test(ua)) {
		dlPrimary.href = "https://dl.astravia.dev/app/v0.0.1/Astravia-0.0.1-arm64.dmg";
		dlPrimaryText!.textContent = "MAC ARM64 (APPLE SILICON)";
		dlPrimaryVersion!.textContent = "v0.0.1 · DMG";
	} else if (isMac) {
		dlPrimary.href = "https://dl.astravia.dev/app/v0.0.1/Astravia-0.0.1.dmg";
		dlPrimaryText!.textContent = "MAC X64 (INTEL)";
		dlPrimaryVersion!.textContent = "v0.0.1 · DMG";
	} else if (isWin) {
		dlPrimary.href = "https://dl.astravia.dev/app/v0.0.1/Astravia-0.0.1-win-x64.exe";
		dlPrimaryText!.textContent = "WINDOWS X64";
		dlPrimaryVersion!.textContent = "v0.0.1 · EXE";
	} else {
		dlPrimary.setAttribute("aria-disabled", "true");
		dlPrimary.removeAttribute("href");
		dlPrimaryText!.textContent = "LINUX";
		dlPrimaryVersion!.textContent = "即将推出";
	}

	// 其他版本展开/收起 + 实时跟随定位
	if (toggle && others) {
		toggle.addEventListener("click", () => {
			const o = others.classList.toggle("is-open");
			toggle.classList.toggle("is-open", o);
		});
		// 监听 others 尺寸变化，实时更新图标位置
		const resizeObserver = new ResizeObserver(() => {
			const positions = calcPositions();
			topIcons.forEach((el, i) => {
				if (positions[i]) {
					const ty = positions[i].y - ICON / 2;
					// 无过渡，直接跟随
					el.style.transition = "none";
					el.style.top = `${ty}px`;
				}
			});
		});
		resizeObserver.observe(others);
	}

	// IntersectionObserver 触发
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					start();
					observer.unobserve(entry.target);
					break;
				}
			}
		},
		{ threshold: 0.15 },
	);
	observer.observe(theater);
}

initConstellation();
