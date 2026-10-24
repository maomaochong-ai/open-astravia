/**
 * 外链跳转：优先开新标签页，窗口被策略拦下时退回当前页跳转。
 *
 * 有些浏览器配置和内嵌 WebView 会静默吞掉 `target="_blank"` —— 点下去既不开窗也不跳转，
 * 用户看到的就是「链接失效」。这里自己发起 open，拿不到窗口就退化为同页导航。
 */

export type ExternalLinkDeps = {
	readonly open: (href: string) => Window | null;
	readonly assign: (href: string) => void;
};

export type ExternalLinkOutcome = "new-window" | "same-tab";

export function openExternalLink(href: string, deps: ExternalLinkDeps): ExternalLinkOutcome {
	if (deps.open(href)) return "new-window";
	deps.assign(href);
	return "same-tab";
}

/* 站内「点开二维码大图」也走新标签页，所以选择器按 target 匹配，不限定 http 外链。 */
const EXTERNAL_LINK_SELECTOR = 'a[target="_blank"]';

export function initExternalLinks(root: ParentNode = document) {
	for (const link of root.querySelectorAll<HTMLAnchorElement>(EXTERNAL_LINK_SELECTOR)) {
		link.addEventListener("click", (event) => {
			if (event.defaultPrevented) return;
			if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			event.preventDefault();
			openExternalLink(link.href, {
				open: (href) => {
					const opened = window.open(href, "_blank");
					// 等价于 rel="noopener"：不给新页面留 opener 引用。
					if (opened) opened.opener = null;
					return opened;
				},
				assign: (href) => window.location.assign(href),
			});
		});
	}
}
