/**
 * 画廊封面的合成：把画布上各 frame 的位图按 manifest 坐标拼成一张全景图。
 *
 * 素材完全复用 frame 位图缓存——画布本来就为每个 frame 截过图并落了 IndexedDB，
 * 这里只是按坐标重排一遍，不额外起引擎、不额外截图。因此「有没有封面」等价于
 * 「这台机器上有没有开过这份设计的画布」，刚 clone / 刚导入的设计没有封面是正常的，
 * 由画廊出占位。
 */
import type { VetdFrameEntry } from "../vetd/manifest-types";
import { loadRasters, saveCover } from "./raster-cache";

/**
 * 长边上限。全景是原比例的（画廊卡片自己 object-cover 裁切），frame 横排时宽高比
 * 可以到几十比一，不设上限就会得到一张又长又没用的巨图。
 */
const MAX_EDGE = 2048;
/** 封面用 jpeg：与 frame 位图同样的理由，同像素下体积小一个量级。 */
const COVER_QUALITY = 0.82;
/** 画不出任何 frame 时的底色，与画布背景同色系。 */
const COVER_BACKGROUND = "#f8fafc";

interface CoverPiece {
	image: HTMLImageElement;
	frame: VetdFrameEntry;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => resolve(null);
		image.src = dataUrl;
	});
}

export interface CoverPlan {
	/** 参与合成的 frame 的外接矩形（画布坐标）。 */
	readonly bounds: { x: number; y: number; width: number; height: number };
	/** 画布坐标 → 位图像素的缩放系数，恒 ≤ 1（不放大，放大只会更糊）。 */
	readonly scale: number;
	readonly width: number;
	readonly height: number;
}

/**
 * 封面的取景与尺寸：外接矩形按原比例缩到长边不超过 `maxEdge`。
 *
 * 保持原比例是刻意的——卡片自己 object-cover 裁切，封面本身要如实反映画布布局。
 * 副作用是 frame 横排的设计会得到很扁的一张图，卡片里只看得到中间一段。
 */
export function planCover(
	frames: readonly { x: number; y: number; width: number; height: number }[],
	maxEdge: number = MAX_EDGE,
): CoverPlan | null {
	if (frames.length === 0) return null;
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const frame of frames) {
		left = Math.min(left, frame.x);
		top = Math.min(top, frame.y);
		right = Math.max(right, frame.x + frame.width);
		bottom = Math.max(bottom, frame.y + frame.height);
	}
	const width = right - left;
	const height = bottom - top;
	if (!(width > 0) || !(height > 0)) return null;
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	return {
		bounds: { x: left, y: top, width, height },
		scale,
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/**
 * 合成一张全景封面并返回 jpeg dataURL。缺素材、画布不可用等一律返回 null——
 * 封面是锦上添花，任何失败都不该冒泡到调用方的主流程。
 */
export async function composeCover(vetdPath: string, frames: readonly VetdFrameEntry[]): Promise<string | null> {
	if (frames.length === 0) return null;
	const rasters = await loadRasters(
		vetdPath,
		frames.map((frame) => frame.id),
	);
	if (rasters.size === 0) return null;

	const pieces: CoverPiece[] = [];
	for (const frame of frames) {
		const dataUrl = rasters.get(frame.id);
		if (!dataUrl) continue;
		const image = await loadImage(dataUrl);
		if (image) pieces.push({ image, frame });
	}
	const plan = planCover(pieces.map((piece) => piece.frame));
	if (!plan) return null;
	const { bounds, scale } = plan;

	const canvas = document.createElement("canvas");
	canvas.width = plan.width;
	canvas.height = plan.height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.fillStyle = COVER_BACKGROUND;
	context.fillRect(0, 0, canvas.width, canvas.height);
	for (const { image, frame } of pieces) {
		context.drawImage(
			image,
			(frame.x - bounds.x) * scale,
			(frame.y - bounds.y) * scale,
			frame.width * scale,
			frame.height * scale,
		);
	}
	try {
		return canvas.toDataURL("image/jpeg", COVER_QUALITY);
	} catch {
		return null;
	}
}

/** 合成并落库。失败静默：画廊下次进来还是走占位，不影响画布本身。 */
export async function refreshCover(vetdPath: string, frames: readonly VetdFrameEntry[]): Promise<void> {
	try {
		const dataUrl = await composeCover(vetdPath, frames);
		if (dataUrl) await saveCover(vetdPath, dataUrl);
	} catch {
		// 见上：封面失败不冒泡。
	}
}
