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
import { LAYOUT_PROBE_SCRIPT } from "../vetd/layout-probe";

export interface OffscreenRasterRequest {
	port: number;
	frameId: string;
	width: number;
	height: number;
	/** jpeg 质量，0–1。 */
	quality: number;
	/** 出图的同时量一次布局（见 vetd/layout-probe）。画布自己的刷新不需要。 */
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

function sessionKeyOf(port: number): string {
	return `design-raster:${port}`;
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
		sessionKey: sessionKeyOf(request.port),
		prepareScript: `window.postMessage({ vetd: true, type: "show-frame", id: ${frameId} }, "*")`,
		// __vetdPainted 由引擎在「chunk 到齐 + 字体就绪 + 绘制过一帧」后写入
		// （见 engine/src/main.tsx 的 FramePainted）；图片解码另等 complete。
		readyExpression: `window.__vetdPainted === ${frameId} && Array.from(document.images).every((img) => img.complete)`,
		settleMs: 300,
		...(request.probeLayout === true ? { probeScript: LAYOUT_PROBE_SCRIPT } : {}),
		timeoutMs: 20_000,
		format: "jpeg",
		quality: request.quality,
	});
	return { dataUrl: result.dataUrl, probe: result.probe };
}

/** 释放引擎对应的离屏窗口（切设计文档 / 强制刷新时；下次截图会重新加载页面）。 */
export function releaseOffscreenRasterSession(port: number): void {
	try {
		void getPluginCtx().capture?.releaseOffscreen(sessionKeyOf(port));
	} catch {
		// ctx 未就绪或宿主不支持：无窗口可释放。
	}
}
