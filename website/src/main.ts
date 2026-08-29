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
}

/* 深浅主题：点击切换并记忆，未手动选择时跟随系统 */
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
initYear();
initThemeToggle();

initFaq();

initStory();
