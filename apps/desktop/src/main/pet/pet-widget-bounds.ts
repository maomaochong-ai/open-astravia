import type { PetContentBounds, PetContentOffset } from "../../shared/pet-ipc.js";

export type PetRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export const DEFAULT_PET_CONTENT_OFFSET: PetContentOffset = { x: 0, y: 1 };

/** 精灵贴顶到这个距离内时，即使还没有气泡也预先把放置方向定为下方，气泡出现时不必翻转。 */
const PET_TOP_EDGE_SLACK = 8;

export function squarePetContent(size: number): PetContentBounds {
	const edge = Math.max(1, Math.round(size));
	return {
		bounds: { x: 0, y: 0, width: edge, height: edge },
		anchor: { x: 0, y: 0, width: edge, height: edge },
		contentOffset: { ...DEFAULT_PET_CONTENT_OFFSET },
	};
}

function normalizePetContentOffset(offset: PetContentOffset | undefined): PetContentOffset {
	if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
		return { ...DEFAULT_PET_CONTENT_OFFSET };
	}
	return { x: Math.round(offset.x), y: offset.y < 0 ? -1 : 1 };
}

export function normalizePetContentBounds(content: number | PetContentBounds): PetContentBounds {
	if (typeof content === "number") return squarePetContent(content);
	return {
		bounds: {
			x: 0,
			y: 0,
			width: Math.max(1, Math.ceil(content.bounds.width)),
			height: Math.max(1, Math.ceil(content.bounds.height)),
		},
		anchor: {
			x: Math.round(content.anchor.x),
			y: Math.round(content.anchor.y),
			width: Math.max(1, Math.round(content.anchor.width)),
			height: Math.max(1, Math.round(content.anchor.height)),
		},
		contentOffset: normalizePetContentOffset(content.contentOffset),
	};
}

function clampRectIntoArea(rect: PetRect, area: PetRect): PetRect {
	const maxX = area.x + Math.max(0, area.width - rect.width);
	const maxY = area.y + Math.max(0, area.height - rect.height);
	return {
		x: Math.min(Math.max(Math.round(rect.x), area.x), maxX),
		y: Math.min(Math.max(Math.round(rect.y), area.y), maxY),
		width: rect.width,
		height: rect.height,
	};
}

export type PetWidgetLayout = {
	/** 精灵的逻辑屏幕位置：只在精灵本身超出工作区时才被夹紧，气泡撑窗不会改动它。 */
	videoScreen: PetRect;
	/** 让内容在工作区内放得下所需的放置方向与水平平移，需下发给渲染层。 */
	contentOffset: PetContentOffset;
	/** 渲染层已按 contentOffset 排版时精确对齐；尚未同步时按目标排版预测，等下一次内容上报再校正。 */
	windowBounds: PetRect;
	/** 渲染层上报的布局是否已经是 contentOffset 描述的那一种。 */
	contentInSync: boolean;
};

/**
 * Stickies / Electron 桌面小组件同款：窗口贴内容，精灵的屏幕位置保持不变。
 * 贴边放不下时先改气泡的放置方向或让精灵在窗口内平移，只有精灵本身出界才夹紧精灵。
 * 放置方向在夹紧之前一次算好，避免先按上方摆再翻到下方的一帧抖动。
 */
export function layoutPetWidget(input: {
	workArea: PetRect;
	videoScreen: PetRect;
	content: number | PetContentBounds;
}): PetWidgetLayout {
	const { workArea } = input;
	const content = normalizePetContentBounds(input.content);
	const { anchor, bounds } = content;
	const reported = content.contentOffset ?? DEFAULT_PET_CONTENT_OFFSET;
	const videoScreen = clampRectIntoArea(
		{ x: input.videoScreen.x, y: input.videoScreen.y, width: anchor.width, height: anchor.height },
		workArea,
	);

	// 去掉渲染层已施加的水平平移，得到气泡相对精灵的自然外扩量；上下外扩量与放置方向无关。
	const naturalAnchorX = anchor.x - reported.x;
	const extraLeft = Math.max(0, naturalAnchorX);
	const extraRight = Math.max(0, bounds.width - naturalAnchorX - anchor.width);
	const extraHeight = Math.max(0, bounds.height - anchor.height);

	const roomAbove = videoScreen.y - workArea.y;
	const roomBelow = workArea.y + workArea.height - (videoScreen.y + videoScreen.height);
	const placeBelow =
		extraHeight > 0
			? roomAbove < extraHeight && (roomBelow >= extraHeight || roomBelow > roomAbove)
			: roomAbove <= PET_TOP_EDGE_SLACK;

	const naturalWindowX = videoScreen.x - extraLeft;
	const overflowRight = naturalWindowX + bounds.width - (workArea.x + workArea.width);
	const underflowLeft = workArea.x - naturalWindowX;
	let shiftX = 0;
	if (overflowRight > 0) {
		shiftX = Math.min(overflowRight, extraRight);
	} else if (underflowLeft > 0) {
		shiftX = -Math.min(underflowLeft, extraLeft);
	}

	const contentOffset: PetContentOffset = { x: shiftX, y: placeBelow ? -1 : 1 };
	const contentInSync = reported.x === contentOffset.x && reported.y === contentOffset.y;
	const localAnchor = contentInSync
		? { x: anchor.x, y: anchor.y }
		: { x: extraLeft + shiftX, y: placeBelow ? 0 : extraHeight };
	// 兜底夹紧只在内容比工作区还大时生效，此时也不回写 videoScreen，气泡消失后精灵仍回到原位。
	const windowBounds = clampRectIntoArea(
		{
			x: videoScreen.x - localAnchor.x,
			y: videoScreen.y - localAnchor.y,
			width: bounds.width,
			height: bounds.height,
		},
		workArea,
	);
	return { videoScreen, contentOffset, windowBounds, contentInSync };
}

export function videoScreenRectFromWindow(windowBounds: PetRect, hitbox: PetRect | undefined): PetRect {
	if (hitbox && hitbox.width > 0 && hitbox.height > 0) {
		return {
			x: windowBounds.x + hitbox.x,
			y: windowBounds.y + hitbox.y,
			width: hitbox.width,
			height: hitbox.height,
		};
	}
	return {
		x: windowBounds.x,
		y: windowBounds.y,
		width: windowBounds.width,
		height: windowBounds.height,
	};
}

export function initialPetVideoScreen(workArea: PetRect, size: number, margin: number): PetRect {
	const edge = Math.max(1, Math.round(size));
	return {
		x: workArea.x + workArea.width - edge - margin,
		y: workArea.y + workArea.height - edge - margin,
		width: edge,
		height: edge,
	};
}

/**
 * 内容变大时必须沿用上一帧精灵的屏幕位置。
 * 气泡先在旧窗口里回流时，新 hitbox 会被视口裁切，不能拿来当锚点。
 */
export function videoScreenForContentResize(input: {
	lastVideoScreen: PetRect | undefined;
	windowBounds: PetRect;
	hitbox: PetRect | undefined;
}): PetRect {
	if (input.lastVideoScreen && input.lastVideoScreen.width > 0 && input.lastVideoScreen.height > 0) {
		return input.lastVideoScreen;
	}
	return videoScreenRectFromWindow(input.windowBounds, input.hitbox);
}
