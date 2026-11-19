import { useEffect, useState } from "react";

/**
 * 极简客户端路由：只支持站内固定路径。
 * 不用第三方路由库——页面就四个，History API 加一个订阅足够。
 */

export const ROUTES = ["/", "/features", "/download", "/about"] as const;
export type RoutePath = (typeof ROUTES)[number];

export const ROUTE_META: Record<RoutePath, { title: string; description: string }> = {
	"/": {
		title: "Astravia · 开源 Agent，为真实工作而生",
		description: "对话、编码、文档、数据库与自动化，一个桌面应用全包。模型自配，数据留在本机。",
	},
	"/features": {
		title: "功能 · Astravia",
		description: "日常事务、编程协作、多形态回答、批量任务、能力广场、并行工作流与主动澄清。",
	},
	"/download": {
		title: "下载 · Astravia",
		description: "macOS、Windows、Linux 桌面客户端与手机端，免费开源，无需注册。",
	},
	"/about": {
		title: "关于 · Astravia",
		description: "Astravia 从哪里开始、是什么、为什么选择开源，以及我们要去的地方。",
	},
};

/** 把地址栏路径归一化成已知路由；未知路径回落到首页。 */
export function normalizePath(pathname: string): RoutePath {
	const clean = pathname.replace(/\/+$/, "") || "/";
	return (ROUTES as readonly string[]).includes(clean) ? (clean as RoutePath) : "/";
}

const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

/** 站内跳转：改历史记录但不刷新页面。 */
export function navigate(to: string, options: { replace?: boolean } = {}) {
	const path = normalizePath(new URL(to, window.location.origin).pathname);
	if (path === normalizePath(window.location.pathname) && !to.includes("#")) return;
	if (options.replace) window.history.replaceState(null, "", to);
	else window.history.pushState(null, "", to);
	emit();

	// 带锚点时滚动到目标，其余一律回到顶部——跨页时保留上一页滚动位置会很怪。
	const hash = to.split("#")[1];
	if (hash) {
		const target = document.getElementById(hash);
		target?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });
	} else {
		window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
	}
}

export function useRoutePath(): RoutePath {
	const [path, setPath] = useState<RoutePath>(() => normalizePath(window.location.pathname));

	useEffect(() => {
		const update = () => setPath(normalizePath(window.location.pathname));
		listeners.add(update);
		window.addEventListener("popstate", update);
		return () => {
			listeners.delete(update);
			window.removeEventListener("popstate", update);
		};
	}, []);

	return path;
}

/** 路由变化时同步文档标题与描述，客户端渲染的页面靠这一步保住可读的标签页。 */
export function useDocumentMeta(path: RoutePath) {
	useEffect(() => {
		const meta = ROUTE_META[path];
		document.title = meta.title;
		for (const selector of ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]']) {
			const tag = document.querySelector<HTMLMetaElement>(selector);
			if (!tag) continue;
			tag.setAttribute("content", selector.includes("description") ? meta.description : meta.title);
		}
	}, [path]);
}
