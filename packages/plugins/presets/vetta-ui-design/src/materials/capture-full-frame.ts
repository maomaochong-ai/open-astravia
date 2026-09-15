/**
 * 截一帧的**完整内容**：视口之外的滚动空间也要。
 *
 * 走宿主离屏窗口（真实 Chromium 渲染管线）：
 * 1. 先按 frame 尺寸截一张，同一时刻用探针量出还藏着多少内容；
 * 2. 有的话把离屏视口拉高到「内容刚好放得下」再截——`h-full` 的滚动容器随之长高，
 *    底部 tab 之类的固定件落到真正的底部，画面就是设计师把画框拉长后看到的样子；
 *    拉高又可能让别的容器多出内容（min-h-screen 之类），所以最多迭代几轮；
 * 3. 内容比宿主允许的最大视口还高（长落地页）时退回分块：视口钉在上限，滚动
 *    容器逐页翻、逐块截，再按 tile-plan 拼成一张。
 *
 * 出图一律 CSS 尺寸 × 宿主的设备像素比；调用方拿到 dataUrl 与像素尺寸。
 */
import type { PluginOffscreenCaptureOptions, PluginOffscreenCaptureResult } from "@vetta-org/plugin-sdk";
import { canvasToJpegDataUrl } from "../mockup/render";
import { FRAME_READY_EXPRESSION, framePrepareScript } from "../canvas/offscreen-raster";
import { SCROLL_PROBE_SCRIPT, SCROLL_RESET_SCRIPT, parseScrollProbe, scrollPrepareScript, scrollReadyExpression } from "./scroll-probe";
import { planTiles } from "./tile-plan";

/**
 * 宿主离屏窗口的单边上限（offscreen-capture-service 的 MAX_VIEWPORT_PX）。
 * 超过会被宿主静默夹到这个数，位图就少一截，所以这边必须自己知道这条线在哪。
 */
export const OFFSCREEN_MAX_VIEWPORT_PX = 4_096;
/** 视口拉高的迭代上限：每轮都是一次真实渲染，三轮还没收敛的（固定高度的内嵌列表）交给分块。 */
const MAX_GROW_PASSES = 3;
/**
 * 拼接画布的物理像素上限。Chromium 的 canvas 单边最大 32767、总面积也有上限，
 * 2 倍屏下 16384 就是 8192 CSS px 的内容——再高的图按比例缩小，宁可略糊也不要出不了图。
 */
const MAX_CANVAS_EDGE_PX = 16_384;
/** 出图前的静置：等图片解码、字体落地。与画布位图队列取同一个值。 */
const SETTLE_MS = 300;
/**
 * 单次截图的预算，取宿主允许的上限。
 *
 * 大头不在截图而在「准备」：引擎刚（重）启动时 vite 要现场编译 tailwind 与整帧模块，
 * 冷启动二三十秒并不罕见；第一帧还要付一次整页加载。位图队列 20s 的预算是给热路径
 * 的，素材导出是用户主动等着的一次性动作，宁可多等也别在编译到一半时放弃。
 */
const TIMEOUT_MS = 60_000;
/**
 * 超时后再试的次数。宿主一旦判超时就销毁那个隐藏窗口，下一次请求拿到的是干净窗口
 * 且服务器多半已经热了——重来一次通常就成。别的错误（页面构建失败、端口没了）重试
 * 也不会变好，原样抛出。
 */
const TIMEOUT_RETRIES = 1;

/** 宿主超时的判据：CaptureTimeoutError 过了 IPC 只剩消息文本。 */
export function isCaptureTimeout(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Capture timed out");
}

export type MaterialFormat = "png" | "jpeg";

export interface FullFrameRequest {
	port: number;
	frameId: string;
	/** frame 的画布尺寸（CSS px）：视口从这里起步。 */
	width: number;
	height: number;
	format: MaterialFormat;
	/** 仅 jpeg。 */
	quality?: number;
}

export interface FullFrameImage {
	dataUrl: string;
	/** 内容的 CSS 尺寸：PDF 页面按它定点数。 */
	cssWidth: number;
	cssHeight: number;
	/** 位图的像素尺寸。 */
	pixelWidth: number;
	pixelHeight: number;
}

/** 可注入的宿主边界：测试用假的截图函数与解码器代替离屏窗口。 */
export interface FullFrameDeps {
	capture(options: PluginOffscreenCaptureOptions): Promise<PluginOffscreenCaptureResult>;
	loadImage(dataUrl: string): Promise<HTMLImageElement>;
}

function sessionKeyOf(port: number): string {
	// 与 offscreen-raster 的「交付物」会话同名：宿主对同一插件最多 4 个会话，
	// 3 个已归画布位图队列，素材导出与 vetd_screenshot 共用剩下这一个。
	return `design-raster:${port}:delivery`;
}

function encode(canvas: HTMLCanvasElement, format: MaterialFormat): string {
	return format === "jpeg" ? canvasToJpegDataUrl(canvas) : canvas.toDataURL("image/png");
}

/**
 * 一次离屏截图 + 同帧量滚动空间。frame 切换走 show-frame 消息，url 不变才能命中
 * 宿主的窗口复用。
 */
async function shoot(
	deps: FullFrameDeps,
	request: FullFrameRequest,
	viewportHeight: number,
	extra: Partial<PluginOffscreenCaptureOptions>,
): Promise<PluginOffscreenCaptureResult> {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await shootOnce(deps, request, viewportHeight, extra);
		} catch (error) {
			if (attempt >= TIMEOUT_RETRIES || !isCaptureTimeout(error)) throw error;
		}
	}
}

async function shootOnce(
	deps: FullFrameDeps,
	request: FullFrameRequest,
	viewportHeight: number,
	extra: Partial<PluginOffscreenCaptureOptions>,
): Promise<PluginOffscreenCaptureResult> {
	return deps.capture({
		url: `http://127.0.0.1:${request.port}/`,
		width: request.width,
		height: viewportHeight,
		sessionKey: sessionKeyOf(request.port),
		prepareScript: framePrepareScript(request.frameId),
		readyExpression: FRAME_READY_EXPRESSION,
		settleMs: SETTLE_MS,
		timeoutMs: TIMEOUT_MS,
		format: request.format,
		...(request.format === "jpeg" ? { quality: request.quality ?? 0.92 } : {}),
		...extra,
	});
}

async function fromDataUrl(deps: FullFrameDeps, dataUrl: string, cssWidth: number, cssHeight: number): Promise<FullFrameImage> {
	const image = await deps.loadImage(dataUrl);
	return { dataUrl, cssWidth, cssHeight, pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight };
}

export async function captureFullFrame(deps: FullFrameDeps, request: FullFrameRequest): Promise<FullFrameImage> {
	let viewportHeight = Math.min(Math.max(1, Math.round(request.height)), OFFSCREEN_MAX_VIEWPORT_PX);
	for (let pass = 0; ; pass += 1) {
		const shot = await shoot(deps, request, viewportHeight, { probeScript: SCROLL_PROBE_SCRIPT });
		const probe = parseScrollProbe(shot.probe);
		// 探针没跑成（页面把 querySelectorAll 都搞挂了？）：视口这一屏就是能给的全部。
		if (!probe || probe.hidden === 0) return fromDataUrl(deps, shot.dataUrl, request.width, viewportHeight);

		const wanted = viewportHeight + probe.hidden;
		const canGrow = viewportHeight < OFFSCREEN_MAX_VIEWPORT_PX && pass < MAX_GROW_PASSES;
		if (canGrow) {
			viewportHeight = Math.min(wanted, OFFSCREEN_MAX_VIEWPORT_PX);
			continue;
		}
		// 拉不动了：视口停在这里，剩下的按滚动分块拼。
		return stitchTiles(deps, request, shot, probe.hidden, probe.top, probe.bottom, viewportHeight);
	}
}

async function stitchTiles(
	deps: FullFrameDeps,
	request: FullFrameRequest,
	first: PluginOffscreenCaptureResult,
	hidden: number,
	top: number,
	bottom: number,
	viewportHeight: number,
): Promise<FullFrameImage> {
	const plan = planTiles({ viewportHeight, top, bottom, hidden });
	const scale = first.scaleFactor > 0 ? first.scaleFactor : 1;
	// 整图太高时整体等比缩小，而不是砍掉底部。
	const fit = Math.min(1, MAX_CANVAS_EDGE_PX / (plan.height * scale), MAX_CANVAS_EDGE_PX / (request.width * scale));
	const draw = scale * fit;
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(request.width * draw));
	canvas.height = Math.max(1, Math.round(plan.height * draw));
	const g = canvas.getContext("2d");
	if (!g) throw new Error("2D canvas context unavailable");
	g.fillStyle = "#ffffff";
	g.fillRect(0, 0, canvas.width, canvas.height);

	for (const [index, tile] of plan.tiles.entries()) {
		const last = index === plan.tiles.length - 1;
		// 第一块就是量高度那一张（scrollTop 为 0），不用再截。
		const shot =
			index === 0
				? first
				: await shoot(deps, request, viewportHeight, {
						prepareScript: scrollPrepareScript(request.frameId, tile.scrollTop),
						readyExpression: scrollReadyExpression(tile.scrollTop),
						// 最后一块出图后把滚动归零，别让共用这个窗口的下一张截图接手一个滚到底的页面。
						...(last ? { probeScript: SCROLL_RESET_SCRIPT } : {}),
					});
		const image = await deps.loadImage(shot.dataUrl);
		const rows = tile.srcBottom - tile.srcTop;
		g.drawImage(
			image,
			0,
			tile.srcTop * scale,
			request.width * scale,
			rows * scale,
			0,
			tile.destTop * draw,
			request.width * draw,
			rows * draw,
		);
	}
	return {
		dataUrl: encode(canvas, request.format),
		cssWidth: request.width,
		cssHeight: plan.height,
		pixelWidth: canvas.width,
		pixelHeight: canvas.height,
	};
}
