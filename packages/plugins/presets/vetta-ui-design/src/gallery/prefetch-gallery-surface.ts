/**
 * 画廊面保持动态 import，不进启动 chunk；插件激活后立刻预取，避免第一次点「设计」
 * 才开始解析整页。模块就绪后若宿主 context 已在，只预扫项目列表 + 缓存 jpeg，
 * 不在首页/会话页后台 compose 封面（那是离开画廊后的掉帧来源）。
 */
import { hasPluginCtx } from "../plugin-context";

export function prefetchGallerySurface(): Promise<unknown> {
	return import("./GalleryView").then((mod) => {
		void prefetchGalleryCardsWithoutCovers();
		// 风格墙跟 GalleryView 同帧挂上；模块趁空闲先解析，避免首帧 Suspense 空白。
		void import("./DesignSystemGrid");
		return mod;
	});
}

function prefetchGalleryCardsWithoutCovers(): void {
	if (!hasPluginCtx()) return;
	void import("./gallery-store")
		.then(({ loadGallery }) => loadGallery({ skipCovers: true }))
		.catch(() => undefined);
}

export function scheduleGallerySurfacePrefetch(delayMs = 0): () => void {
	const id = globalThis.setTimeout(() => {
		void prefetchGallerySurface();
	}, delayMs);
	return () => globalThis.clearTimeout(id);
}
