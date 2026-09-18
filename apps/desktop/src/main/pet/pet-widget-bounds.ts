import type { PetContentBounds } from "../../shared/pet-ipc.js";

export type PetRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export function squarePetContent(size: number): PetContentBounds {
	const edge = Math.max(1, Math.round(size));
	return {
		bounds: { x: 0, y: 0, width: edge, height: edge },
		anchor: { x: 0, y: 0, width: edge, height: edge },
	};
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
	};
}

/**
 * Stickies / Electron 桌面小组件同款：窗口贴内容，视频的屏幕位置保持不变。
 * 贴边时只平移窗口，不缩放内容。
 */
export function nextPetWindowBounds(input: {
	workArea: PetRect;
	videoScreen: PetRect;
	content: PetContentBounds;
}): PetRect {
	const content = normalizePetContentBounds(input.content);
	const width = content.bounds.width;
	const height = content.bounds.height;
	let x = Math.round(input.videoScreen.x - content.anchor.x);
	let y = Math.round(input.videoScreen.y - content.anchor.y);
	const maxX = input.workArea.x + Math.max(0, input.workArea.width - width);
	const maxY = input.workArea.y + Math.max(0, input.workArea.height - height);
	x = Math.min(Math.max(x, input.workArea.x), maxX);
	y = Math.min(Math.max(y, input.workArea.y), maxY);
	return { x, y, width, height };
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

/** 窗口贴顶时气泡改到精灵下方，避免被菜单栏裁切。x 恒为 0：位置由窗口 bounds 承担。 */
export function petContentOffsetForBubblePlacement(windowBounds: PetRect, workArea: PetRect): { x: number; y: number } {
	return {
		x: 0,
		y: windowBounds.y <= workArea.y + 8 ? -1 : 1,
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

export function videoScreenAfterWindowLayout(windowBounds: PetRect, content: PetContentBounds): PetRect {
	const normalized = normalizePetContentBounds(content);
	return {
		x: windowBounds.x + normalized.anchor.x,
		y: windowBounds.y + normalized.anchor.y,
		width: normalized.anchor.width,
		height: normalized.anchor.height,
	};
}
