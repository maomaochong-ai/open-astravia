import { type ReactNode, useEffect } from "react";

import { navigate } from "./router";

/** 站内链接：拦截左键点击走客户端路由，其余修饰键交回浏览器。 */
export function Link({
	to,
	children,
	className,
	ariaLabel,
	onClick,
}: {
	to: string;
	children: ReactNode;
	className?: string;
	ariaLabel?: string;
	onClick?: () => void;
}) {
	return (
		<a
			href={to}
			className={className}
			aria-label={ariaLabel}
			onClick={(event) => {
				onClick?.();
				if (event.defaultPrevented) return;
				if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
				event.preventDefault();
				navigate(to);
			}}
		>
			{children}
		</a>
	);
}

/** 外链：始终新窗口，且不给新页面留 opener 引用。 */
export function ExternalLink({
	href,
	children,
	className,
	ariaLabel,
}: {
	href: string;
	children: ReactNode;
	className?: string;
	ariaLabel?: string;
}) {
	return (
		<a
			href={href}
			className={className}
			aria-label={ariaLabel}
			target="_blank"
			rel="noopener noreferrer"
		>
			{children}
		</a>
	);
}

/**
 * 滚动显现。
 *
 * 用「元素顶部是否已越过视口下沿」判定，而不是 IntersectionObserver 的比例阈值：
 * 客户端路由切换与分段切换都会重建节点，比例阈值在重建后可能一次都不触发，
 * 结果就是整块内容停在 opacity: 0——用户看到的就是「这个页面丢了内容」。
 * 这里每次滚动、尺寸变化、DOM 变化与路由切换都补一遍，凡是进入视口的元素一律显示。
 */
export function useReveal(routeKey?: string) {
	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			for (const el of document.querySelectorAll<HTMLElement>(".reveal")) el.classList.add("is-visible");
			return;
		}

		let frame = 0;
		let settle = 0;
		const pass = () => {
			frame = 0;
			const limit = window.innerHeight * 0.94;
			for (const el of document.querySelectorAll<HTMLElement>(".reveal")) {
				if (el.classList.contains("is-visible")) continue;
				if (el.getBoundingClientRect().top < limit) el.classList.add("is-visible");
			}
		};
		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(pass);
			// 结构刚变过时布局可能还没稳定，补两次收敛。
			clearTimeout(settle);
			settle = window.setTimeout(pass, 120);
		};

		pass();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		const mutations = new MutationObserver(schedule);
		mutations.observe(document.body, { childList: true, subtree: true });

		return () => {
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
			mutations.disconnect();
			if (frame) cancelAnimationFrame(frame);
			clearTimeout(settle);
			// 离开这一页时清掉状态，下次进来重新播放。
			for (const el of document.querySelectorAll<HTMLElement>(".reveal")) el.classList.remove("is-visible");
		};
	}, [routeKey]);
}

/** 通用图标：站内所有箭头与勾选都从这里取，避免每个页面各写一份 path。 */
export const Icon = {
	Arrow: (props: { size?: number; className?: string }) => (
		<svg
			aria-hidden="true"
			width={props.size ?? 13}
			height={props.size ?? 13}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={props.className}
		>
			<path d="M5 12h14" />
			<path d="m12 5 7 7-7 7" />
		</svg>
	),
	Download: (props: { size?: number }) => (
		<svg
			aria-hidden="true"
			width={props.size ?? 16}
			height={props.size ?? 16}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<path d="m7 10 5 5 5-5" />
			<path d="M12 15V3" />
		</svg>
	),
	Check: (props: { size?: number; className?: string }) => (
		<svg
			aria-hidden="true"
			width={props.size ?? 11}
			height={props.size ?? 11}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={props.className}
		>
			<path d="m20 6-11 11-5-5" />
		</svg>
	),
	Chevron: (props: { size?: number; className?: string }) => (
		<svg
			aria-hidden="true"
			width={props.size ?? 13}
			height={props.size ?? 13}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={props.className}
		>
			<path d="m6 9 6 6 6-6" />
		</svg>
	),
	GitHub: (props: { size?: number }) => (
		<svg aria-hidden="true" width={props.size ?? 15} height={props.size ?? 15} viewBox="0 0 24 24" fill="currentColor">
			<path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
		</svg>
	),
	Mail: (props: { size?: number }) => (
		<svg
			aria-hidden="true"
			width={props.size ?? 15}
			height={props.size ?? 15}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="2" y="4" width="20" height="16" rx="2" />
			<path d="m2 7 10 6 10-6" />
		</svg>
	),
	Issue: (props: { size?: number }) => (
		<svg
			aria-hidden="true"
			width={props.size ?? 15}
			height={props.size ?? 15}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 8v4" />
			<path d="M12 16h.01" />
		</svg>
	),
};
