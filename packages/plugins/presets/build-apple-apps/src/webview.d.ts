import type { DetailedHTMLProps, HTMLAttributes } from "react";

/**
 * Electron `<webview>`。宿主主窗口开启了 webviewTag，内置浏览器面板用的就是它。
 *
 * 这里必须用 webview 而不是 iframe：baguette serve 对每个响应都下发
 * `Content-Security-Policy: frame-ancestors 'none'`（`--allowed-hosts` 也不放开），
 * iframe 一律被浏览器拦成白屏。webview 的 guest 是独立的顶层浏览上下文，
 * 不属于嵌套浏览上下文，因此不受 frame-ancestors 约束。
 */
declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			webview: DetailedHTMLProps<
				HTMLAttributes<HTMLElement> & {
					src?: string;
					partition?: string;
					allowpopups?: boolean;
				},
				HTMLElement
			>;
		}
	}
}
