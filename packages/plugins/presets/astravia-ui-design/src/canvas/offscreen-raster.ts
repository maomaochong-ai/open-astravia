/**
 * 走宿主离屏窗口的位图截图（ctx.capture.offscreen）。
 *
 * 与 iframe 内 html-to-image 的本质区别：这里是真实 Chromium 渲染管线直接出图，
 * 不存在「克隆 DOM 到 SVG 再重排」带来的断行、半像素基线偏移——位图与活体逐像素
 * 一致。同一个引擎 dev server 复用一个离屏窗口（SPA 客户端路由切帧），每帧只付
 * React 渲染 + 静置的成本，且完全不占画布渲染进程的主线程。
 *
 * 旧宿主没有这个能力（ctx.capture 为 undefined），调用方据 supported() 回落到
 * html-to-image 老路。
 */
import { getPluginCtx } from "../plugin-context";
import { LAYOUT_PROBE_SCRIPT } from "../astd/layout-probe";

/**
 * 画布位图队列可以并行占用的离屏会话数。
 *
 * 宿主对同一插件最多 4 个会话（offscreen-capture-service 的 MAX_SESSIONS_PER_PLUGIN），
 * 这里占 3，剩下的一个留给交付物截图（不带 slot 的调用，见下）——否则用户正在截图/
 * 导出时会撞上「Too many capture sessions」。
 */
export const OFFSCREEN_RASTER_SLOTS = 3;

export interface OffscreenRasterRequest {
	port: number;
	frameId: string;
	width: number;
	height: number;
	/** jpeg 质量，0–1。 */
	quality: number;
	/**
	 * 位图队列的槽位（0 起，上限 OFFSCREEN_RASTER_SLOTS）。同一 slot 的请求在宿主侧
	 * 串行复用同一个隐藏窗口，不同 slot 之间才是真并行。
	 * 省略表示交付物那条路：独占一个会话，不和后台队列抢窗口。
	 */
	slot?: number;
	/** 出图的同时量一次布局（见 astd/layout-probe）。画布自己的刷新不需要。 */
	probeLayout?: boolean;
}

export interface OffscreenRasterResult {
	dataUrl: string;
	/** `probeLayout` 时探针的原始结果，交给 layoutIssues 解释；宿主不支持时为 undefined。 */
	probe: unknown;
}

export function offscreenRasterSupported(): boolean {
	try {
		return typeof getPluginCtx().capture?.offscreen === "function";
	} catch {
		return false;
	}
}

function sessionKeyOf(port: number, slot: number | null): string {
	return slot === null ? `design-raster:${port}:delivery` : `design-raster:${port}:${slot}`;
}

export async function captureFrameOffscreen(request: OffscreenRasterRequest): Promise<OffscreenRasterResult> {
	const capture = getPluginCtx().capture;
	if (!capture) throw new Error("offscreen capture unavailable");
	const frameId = JSON.stringify(request.frameId);
	const result = await capture.offscreen({
		// 恒定加载根路径，切帧走 show-frame 消息（bridge 的既有协议）：url 不变
		// 才能命中宿主的窗口复用，免掉每帧一次整页加载。
		url: `http://127.0.0.1:${request.port}/`,
		width: request.width,
		height: request.height,
		sessionKey: sessionKeyOf(request.port, request.slot ?? null),
		prepareScript: `window.postMessage({ astd: true, type: "show-frame", id: ${frameId} }, "*")`,
		// __astdPainted 由引擎在「chunk 到齐 + 字体就绪 + 绘制过一帧」后写入
		// （见 engine/src/main.tsx 的 FramePainted）；图片解码另等 complete。
		readyExpression: `window.__astdPainted === ${frameId} && Array.from(document.images).every((img) => img.complete)`,
		settleMs: 300,
		...(request.probeLayout === true ? { probeScript: LAYOUT_PROBE_SCRIPT } : {}),
		timeoutMs: 20_000,
		format: "jpeg",
		quality: request.quality,
	});
	return { dataUrl: result.dataUrl, probe: result.probe };
}

/**
 * 释放引擎对应的全部离屏窗口（切设计文档 / 强制刷新时；下次截图会重新加载页面）。
 * 池里每个槽位都是独立会话，漏掉任何一个都会让那一格继续拿旧页面出图。
 */
export function releaseOffscreenRasterSession(port: number): void {
	try {
		const capture = getPluginCtx().capture;
		if (!capture) return;
		for (let slot = 0; slot < OFFSCREEN_RASTER_SLOTS; slot += 1) {
			void capture.releaseOffscreen(sessionKeyOf(port, slot));
		}
		void capture.releaseOffscreen(sessionKeyOf(port, null));
	} catch {
		// ctx 未就绪或宿主不支持：无窗口可释放。
	}
}
