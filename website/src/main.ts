/**
 * 星轨 Astravia 官网交互
 * 纯 TypeScript，无运行时依赖。
 */

import "./style.css";

import { initDownloadLinks, initDownloadPlatformHighlight } from "./download-links";
import { initExternalLinks } from "./external-links";
import { initMobileInstall } from "./mobile-install";

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
		?.setAttribute("content", theme === "dark" ? "#0d0d0d" : "#ffffff");
}

const QR_LINKS = [...document.querySelectorAll<HTMLAnchorElement>("a.qr-card[data-poster-dark][data-poster-light]")];

/* 产品截图有深浅两张：图里自带界面底色，跟着主题换，否则深色页上会嵌一块白框 */
const APP_SHOT = document.querySelector<HTMLImageElement>("img#appShot[data-shot-dark][data-shot-light]");

function applyAppShot(theme: Theme) {
	if (!APP_SHOT) return;
	const next = theme === "dark" ? APP_SHOT.dataset.shotDark : APP_SHOT.dataset.shotLight;
	if (next && APP_SHOT.getAttribute("src") !== next) APP_SHOT.setAttribute("src", next);
}

/* 社群海报有大片自带底色：深色主题用深底海报、浅色主题用浅底海报，
   否则海报底色会和界面底色撞出一个粗边框。二维码本体是透明底，不受影响 */
function applyCommunityPosters(theme: Theme) {
	for (const link of QR_LINKS) {
		const next = theme === "dark" ? link.dataset.posterDark : link.dataset.posterLight;
		if (next && link.getAttribute("href") !== next) link.setAttribute("href", next);
	}
}

/* 深浅主题：点击切换并记忆；默认深色，只有存过 light 才回浅色 */
function initThemeToggle() {
	// 静态标记写的是 dark，这里把记忆值同步回去：刷新后不会闪回默认色。
	document.documentElement.dataset.theme = getCurrentTheme();
	applyCommunityPosters(getCurrentTheme());
	applyAppShot(getCurrentTheme());
	if (!THEME_TOGGLE) return;
	applyThemeToggleState(getCurrentTheme());
	THEME_TOGGLE.addEventListener("click", () => {
		const next: Theme = getCurrentTheme() === "dark" ? "light" : "dark";
		document.documentElement.classList.add("theme-transition");
		window.setTimeout(() => document.documentElement.classList.remove("theme-transition"), 350);
		document.documentElement.dataset.theme = next;
		localStorage.setItem(THEME_KEY, next);
		applyThemeToggleState(next);
		applyCommunityPosters(next);
		applyAppShot(next);
	});
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
		// 用户未手动选择过时，图标状态跟随系统切换
		if (!document.documentElement.dataset.theme) {
			applyThemeToggleState(event.matches ? "dark" : "light");
			applyCommunityPosters(event.matches ? "dark" : "light");
			applyAppShot(event.matches ? "dark" : "light");
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

initNavScroll();
initNavToggle();
initReveal();
initActiveNav();
initSmoothScroll();
initExternalLinks();
initYear();
initThemeToggle();

initFaq();
initDownloadLinks();

/*
 * 工作台视图切换：三个 tab 各自对应一块 stage，切换只切 hidden + 类名。
 * 内容本身是静态标记（不引入第二个前端框架），动画交给 CSS 过渡。
 */
function initWorkbenchTabs() {
	const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tabs .tab[data-view]")];
	const views = [...document.querySelectorAll<HTMLElement>("[data-stage-view]")];
	if (tabs.length === 0 || views.length === 0) return;

	const show = (view: string) => {
		for (const tab of tabs) {
			const on = tab.dataset.view === view;
			tab.classList.toggle("is-active", on);
			tab.setAttribute("aria-selected", String(on));
			// 只有当前 tab 可 Tab 键停留，其余靠方向键走——roving tabindex。
			tab.tabIndex = on ? 0 : -1;
		}
		for (const panel of views) {
			const on = panel.dataset.stageView === view;
			panel.hidden = !on;
			panel.classList.toggle("is-active", on);
			if (on) {
				// 重新触发入场：先摘掉再强制回流，动画才会每次播放。
				panel.classList.remove("is-entering");
				void panel.offsetWidth;
				panel.classList.add("is-entering");
			}
		}
	};

	show(tabs.find((t) => t.classList.contains("is-active"))?.dataset.view ?? "live");

	for (const tab of tabs) {
		tab.addEventListener("click", () => show(tab.dataset.view ?? "live"));
	}
	// 方向键在 tab 之间移动，符合 role="tablist" 的键盘预期。
	document.querySelector(".tabs")?.addEventListener("keydown", (event) => {
		const key = (event as KeyboardEvent).key;
		if (key !== "ArrowRight" && key !== "ArrowLeft") return;
		const index = tabs.findIndex((t) => t.classList.contains("is-active"));
		if (index < 0) return;
		const next = (index + (key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
		show(tabs[next].dataset.view ?? "live");
		tabs[next].focus();
	});
}

initWorkbenchTabs();
initDownloadPlatformHighlight();

/* 「其他版本」折叠：展开/收起只切一个类，高度由 CSS 过渡。 */
function initDownloadOthers() {
	const toggle = document.getElementById("dlOthersToggle");
	const others = document.getElementById("dlOthers");
	if (!toggle || !others) return;
	toggle.addEventListener("click", () => {
		const open = others.classList.toggle("is-open");
		toggle.classList.toggle("is-open", open);
		toggle.setAttribute("aria-expanded", String(open));
	});
}

initDownloadOthers();

initMobileInstall();
