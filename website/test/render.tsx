// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { Layout } from "../src/app/layout";
import { AboutPage } from "../src/pages/about";
import { DownloadPage } from "../src/pages/download";
import { FeaturesPage } from "../src/pages/features";
import { HomePage } from "../src/pages/home";

export type PageName = "home" | "features" | "download" | "about";

const PAGES: Record<PageName, () => React.ReactElement> = {
	home: HomePage,
	features: FeaturesPage,
	download: DownloadPage,
	about: AboutPage,
};

/**
 * 测试把页面渲染成静态标记再断言。
 * 页面是 React 组件，直接读源码文本只能验证「写了什么」，
 * 渲染后验证的是「用户实际拿到什么」，组件重构时断言依然成立。
 */
export function renderPage(name: PageName): string {
	const Page = PAGES[name];
	return renderToStaticMarkup(createElement(Layout, null, createElement(Page)));
}

export const PAGE_NAMES = Object.keys(PAGES) as PageName[];
