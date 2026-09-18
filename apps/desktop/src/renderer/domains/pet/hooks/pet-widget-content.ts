import type { PetContentBounds, PetContentOffset, PetVideoHitbox } from "../../../../shared/pet-ipc";

export function clientRectToHitbox(
	rect: { left: number; top: number; right: number; bottom: number },
	viewport: { width: number; height: number },
): PetVideoHitbox | undefined {
	const left = Math.max(0, rect.left);
	const top = Math.max(0, rect.top);
	const right = Math.min(viewport.width, rect.right);
	const bottom = Math.min(viewport.height, rect.bottom);
	if (right <= left || bottom <= top) return undefined;
	return {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	};
}

/**
 * 上报给主进程的内容布局。带上测量时生效的 contentOffset，
 * 主进程才能分辨这份布局是否已经按它下发的放置方向 / 平移排好，而不是靠猜。
 */
export function measurePetWidgetContent(input: {
	shell: { width: number; height: number };
	video?: { left: number; top: number; width: number; height: number };
	contentOffset: PetContentOffset;
}): PetContentBounds {
	const bounds = {
		x: 0,
		y: 0,
		width: Math.max(1, Math.ceil(input.shell.width)),
		height: Math.max(1, Math.ceil(input.shell.height)),
	};
	const contentOffset = { x: Math.round(input.contentOffset.x), y: Math.round(input.contentOffset.y) };
	const video = input.video;
	if (!video || video.width <= 0 || video.height <= 0) {
		return {
			bounds,
			anchor: { x: 0, y: 0, width: bounds.width, height: bounds.height },
			contentOffset,
		};
	}
	return {
		bounds,
		anchor: {
			x: Math.round(video.left),
			y: Math.round(video.top),
			width: Math.max(1, Math.round(video.width)),
			height: Math.max(1, Math.round(video.height)),
		},
		contentOffset,
	};
}

export function samePetHitbox(left?: PetVideoHitbox, right?: PetVideoHitbox): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

export function samePetContentBounds(left?: PetContentBounds, right?: PetContentBounds): boolean {
	if (left === right) return true;
	if (!left || !right) return false;
	return (
		left.bounds.width === right.bounds.width &&
		left.bounds.height === right.bounds.height &&
		left.anchor.x === right.anchor.x &&
		left.anchor.y === right.anchor.y &&
		left.anchor.width === right.anchor.width &&
		left.anchor.height === right.anchor.height &&
		left.contentOffset?.x === right.contentOffset?.x &&
		left.contentOffset?.y === right.contentOffset?.y
	);
}
