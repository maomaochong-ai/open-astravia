import { PET_ACTIONS, type PetActionId } from "../../../../shared/pet-actions";
import { normalizePetBubbleStyleId, type PetBubbleStyleId } from "../../../../shared/pet-bubbles";
import {
	DEFAULT_PET_VIDEO_SCALE,
	normalizePetVideoScale,
	normalizePetVideoSize,
	type PetVideoBaseSizeByAction,
} from "../../../../shared/pet-config";
import { pickIdleAction } from "./pet-action-picker";
import type { PetVideoMap } from "./pet-types";

function getSearchParams(): URLSearchParams {
	return new URLSearchParams(window.location.search);
}

export function getVideoMap(): PetVideoMap {
	const params = getSearchParams();
	const videos: PetVideoMap = {};
	for (const action of PET_ACTIONS) {
		const video = params.get(action.id);
		if (video && video.length > 0) {
			videos[action.id] = video;
		}
	}

	const legacyVideo = params.get("video");
	if (legacyVideo && legacyVideo.length > 0) {
		videos.stoat_work_laptop_typing_desk_cushion = legacyVideo;
	}

	return videos;
}

export function getInitialBubbleStyle(): { styleId: PetBubbleStyleId; decorUrl?: string } {
	const params = getSearchParams();
	const decorUrl = params.get("bubbleDecor");
	return {
		styleId: normalizePetBubbleStyleId(params.get("bubbleStyle")),
		...(decorUrl && decorUrl.length > 0 ? { decorUrl } : {}),
	};
}

export function getInitialAutoMode(): boolean {
	return getSearchParams().get("autoMode") !== "false";
}

export function getInitialDebugFrame(): boolean {
	return getSearchParams().get("debugFrame") === "true";
}

export function getInitialVideoScale(): number {
	const scale = Number(getSearchParams().get("videoScale"));
	return normalizePetVideoScale(Number.isFinite(scale) ? scale : DEFAULT_PET_VIDEO_SCALE);
}

export function getInitialVideoBaseSizeByAction(): PetVideoBaseSizeByAction {
	const params = getSearchParams();
	const sizes = {} as PetVideoBaseSizeByAction;
	for (const action of PET_ACTIONS) {
		const baseSize = Number(params.get(`${action.id}VideoBaseSize`) ?? params.get(`${action.id}VideoSize`));
		sizes[action.id] = Number.isFinite(baseSize) ? normalizePetVideoSize(baseSize) : action.videoBaseSize;
	}
	return sizes;
}

export function getInitialAction(videos: PetVideoMap): PetActionId | undefined {
	return pickIdleAction(videos);
}

/** 默认贴主屏工作区右下角（与 main `getInitialPetContentOffset` 一致）；URL 优先。 */
export function getInitialContentOffset(): { x: number; y: number } {
	const params = getSearchParams();
	const x = Number(params.get("contentOffsetX"));
	const y = Number(params.get("contentOffsetY"));
	if (Number.isFinite(x) && Number.isFinite(y)) {
		return { x: Math.round(x), y: Math.round(y) };
	}
	const margin = 24;
	const halfSize = 110;
	return {
		x: Math.round(window.innerWidth / 2 - halfSize - margin),
		y: Math.round(window.innerHeight / 2 - halfSize - margin),
	};
}
