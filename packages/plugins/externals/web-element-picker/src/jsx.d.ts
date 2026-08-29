import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";

/**
 * Electron <webview> 的最小 renderer 类型声明。
 *
 * 插件 MF 组件与宿主运行在同一 renderer，`webviewTag: true` 全局生效，
 * 但插件包内没有 Electron 类型，这里声明本插件用到的子集：
 * - 导航 / 刷新 / 前进后退
 * - executeJavaScript（注入选择器内核，不受页面 CSP 限制）
 * - capturePage（阶段 3 截图）
 */
declare global {
	interface WebviewImage {
		toDataURL(): string;
		toPNG(): Uint8Array;
		getSize(): { width: number; height: number };
	}

	interface WebviewTag extends HTMLElement {
		src: string;
		partition?: string;
		allowpopups?: boolean;
		getURL(): string;
		loadURL(url: string): Promise<void>;
		reload(): void;
		stop(): void;
		goBack(): void;
		goForward(): void;
		canGoBack(): boolean;
		canGoForward(): boolean;
		executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
		capturePage(
			rect?: { x: number; y: number; width: number; height: number },
		): Promise<WebviewImage>;
	}

	interface Window {
		/** 选择器内核挂载点（由 executeJavaScript 注入的 iife 定义）。 */
		__WEP__?: {
			mount(options?: { lang?: string }): void;
			destroy(): void;
			applySettings?(settings: Record<string, unknown>): void;
			applyLang?(lang: string): void;
		};
	}
}

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			webview: DetailedHTMLProps<HTMLAttributes<WebviewTag>, WebviewTag> & {
				src?: string;
				partition?: string;
				allowpopups?: boolean | string;
				ref?: Ref<WebviewTag>;
			};
		}
	}
}
