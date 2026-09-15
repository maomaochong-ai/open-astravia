/**
 * 素材截图的入口：画布「下载素材」与 agent 的 vetd_export 共用。
 *
 * 两边拿到的是同一张图——完整内容（含视口外的滚动空间）走宿主离屏窗口；旧宿主
 * 没有这个能力时退回画布 iframe 里的 html-to-image，那条路只截得到视口这一屏，
 * 是能给的最好结果。
 */
import { getFrameError } from "../canvas/design-runtime";
import { offscreenRasterSupported } from "../canvas/offscreen-raster";
import { loadImage } from "../mockup/load-image";
import { getPluginCtx } from "../plugin-context";
import { captureFullFrame, type FullFrameImage, type MaterialFormat } from "./capture-full-frame";

export interface MaterialTarget {
	/** 引擎 dev server 端口。 */
	port: number;
	frame: { id: string; width: number; height: number };
	/** 离屏不可用时的退路：画布 iframe 内截一张 png dataUrl。 */
	captureInCanvas(frameId: string): Promise<string>;
}

export async function captureMaterial(target: MaterialTarget, format: MaterialFormat): Promise<FullFrameImage> {
	const { frame } = target;
	// 构建失败的帧渲染的是错误占位，永远不会发出「画完了」的信号——离屏截图只会
	// 白等到超时。先问一声，立刻把编译错误报出去。
	const buildError = getFrameError(frame.id);
	if (buildError) throw new Error(`Frame "${frame.id}" cannot build:\n${buildError}`);
	if (offscreenRasterSupported()) {
		const capture = getPluginCtx().capture;
		if (!capture) throw new Error("offscreen capture unavailable");
		return captureFullFrame(
			{ capture: (options) => capture.offscreen(options), loadImage },
			{ port: target.port, frameId: frame.id, width: frame.width, height: frame.height, format },
		);
	}
	const dataUrl = await target.captureInCanvas(frame.id);
	const image = await loadImage(dataUrl);
	return {
		dataUrl,
		cssWidth: frame.width,
		cssHeight: frame.height,
		pixelWidth: image.naturalWidth,
		pixelHeight: image.naturalHeight,
	};
}
