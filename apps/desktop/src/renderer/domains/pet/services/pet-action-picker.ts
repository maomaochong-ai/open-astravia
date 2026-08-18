import {
	getIdlePetActionIds,
	getPetActionDurationRange,
	getWeightedPetActionIdsForNow,
} from "../../../../shared/pet-action-selection";
import { PET_ACTIONS, type PetActionId } from "../../../../shared/pet-actions";
import type { PetVideoMap } from "./pet-types";

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getAvailableActionIds(videos: PetVideoMap): PetActionId[] {
	return PET_ACTIONS.map((action) => action.id).filter((id) => videos[id] != null);
}

export function pickIdleAction(videos: PetVideoMap): PetActionId | undefined {
	for (const actionId of getIdlePetActionIds()) {
		if (videos[actionId] != null) return actionId;
	}
	return getAvailableActionIds(videos)[0];
}

export function pickNextAction(videos: PetVideoMap, previous?: PetActionId): PetActionId | undefined {
	const available = getAvailableActionIds(videos);
	if (available.length === 0) return undefined;

	const preferred = getWeightedPetActionIdsForNow().filter((id) => videos[id] != null);
	const pool = preferred.length > 0 ? preferred : available;
	let selected = pool[randomInt(0, pool.length - 1)];
	if (available.length > 1 && selected === previous) {
		const alternatives = pool.filter((id) => id !== previous);
		if (alternatives.length > 0) {
			selected = alternatives[randomInt(0, alternatives.length - 1)];
		}
	}
	return selected;
}

export function getActionDuration(actionId: PetActionId): number {
	const duration = getPetActionDurationRange(actionId);
	return randomInt(duration.minMs, duration.maxMs);
}
