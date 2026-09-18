export const PET_MOUSE_POLL_NEAR_MS = 50;
export const PET_MOUSE_POLL_FAR_MS = 100;
export const PET_MOUSE_POLL_PROXIMITY_PX = 240;

export interface PetMousePollPoint {
	readonly x: number;
	readonly y: number;
}

export interface PetMousePollRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export function isPointNearRect(point: PetMousePollPoint, rect: PetMousePollRect, padding: number): boolean {
	return (
		point.x >= rect.x - padding &&
		point.x <= rect.x + rect.width + padding &&
		point.y >= rect.y - padding &&
		point.y <= rect.y + rect.height + padding
	);
}

export function nextPetMousePollMs(input: {
	readonly dragging: boolean;
	readonly cursor: PetMousePollPoint;
	readonly windowBounds: PetMousePollRect;
}): number {
	if (input.dragging) return PET_MOUSE_POLL_NEAR_MS;
	return isPointNearRect(input.cursor, input.windowBounds, PET_MOUSE_POLL_PROXIMITY_PX)
		? PET_MOUSE_POLL_NEAR_MS
		: PET_MOUSE_POLL_FAR_MS;
}
